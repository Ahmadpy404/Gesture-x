/**
 * @fileoverview Gesture X — VoiceCommandMatcher
 *
 * Converts a raw speech recognition transcript into a structured command match.
 *
 * Matching pipeline:
 *  1. Normalize transcript (lowercase, strip punctuation, collapse whitespace)
 *  2. Exact phrase match — O(n), highest confidence
 *  3. Contains match — transcript contains the full command phrase
 *  4. Word-overlap fuzzy match — catches minor mis-recognitions
 *  5. Return the highest-scoring match above the confidence threshold
 *
 * The command vocabulary is a flat array of { phrase, commandId } pairs.
 * Aliases (multiple phrases → same command) are first-class entries.
 *
 * Design decisions:
 *  - No regex / ML — fast, deterministic, debuggable.
 *  - Confidence is a normalized 0–1 score, not the browser's raw SpeechResult score.
 *  - Short phrases (≤2 words) require higher word-overlap to prevent false positives.
 */

import { CommandId } from '../../shared/constants.js';
import { createLogger } from '../../shared/Logger.js';

const log = createLogger('VoiceCommandMatcher');

// ---------------------------------------------------------------------------
// Command vocabulary
// ---------------------------------------------------------------------------

/**
 * @typedef {{ phrase: string, commandId: string }} VoiceCommandEntry
 * @type {VoiceCommandEntry[]}
 *
 * Ordered by specificity (longer, more specific phrases first)
 * to prevent shorter aliases from shadow-matching.
 */
const VOICE_COMMANDS = [
  // Navigation
  { phrase: 'scroll to the bottom', commandId: CommandId.SCROLL_BOTTOM },
  { phrase: 'scroll to the top',    commandId: CommandId.SCROLL_TOP    },
  { phrase: 'scroll to bottom',     commandId: CommandId.SCROLL_BOTTOM },
  { phrase: 'scroll to top',        commandId: CommandId.SCROLL_TOP    },
  { phrase: 'go to the bottom',     commandId: CommandId.SCROLL_BOTTOM },
  { phrase: 'go to the top',        commandId: CommandId.SCROLL_TOP    },
  { phrase: 'go to bottom',         commandId: CommandId.SCROLL_BOTTOM },
  { phrase: 'go to top',            commandId: CommandId.SCROLL_TOP    },
  { phrase: 'go back',              commandId: CommandId.NAV_BACK      },
  { phrase: 'go backwards',         commandId: CommandId.NAV_BACK      },
  { phrase: 'go forward',           commandId: CommandId.NAV_FORWARD   },
  { phrase: 'go forwards',          commandId: CommandId.NAV_FORWARD   },
  { phrase: 'go home',              commandId: CommandId.NAV_HOME      },
  { phrase: 'navigate back',        commandId: CommandId.NAV_BACK      },
  { phrase: 'navigate forward',     commandId: CommandId.NAV_FORWARD   },

  // Page actions
  { phrase: 'reload page',          commandId: CommandId.NAV_RELOAD    },
  { phrase: 'refresh page',         commandId: CommandId.NAV_RELOAD    },
  { phrase: 'reload',               commandId: CommandId.NAV_RELOAD    },
  { phrase: 'refresh',              commandId: CommandId.NAV_RELOAD    },

  // Tabs
  { phrase: 'open new tab',         commandId: CommandId.TAB_NEW       },
  { phrase: 'new tab',              commandId: CommandId.TAB_NEW       },
  { phrase: 'close this tab',       commandId: CommandId.TAB_CLOSE     },
  { phrase: 'close tab',            commandId: CommandId.TAB_CLOSE     },
  { phrase: 'next tab',             commandId: CommandId.TAB_NEXT      },
  { phrase: 'previous tab',         commandId: CommandId.TAB_PREV      },
  { phrase: 'reopen tab',           commandId: CommandId.TAB_REOPEN    },
  { phrase: 'reopen closed tab',    commandId: CommandId.TAB_REOPEN    },
  { phrase: 'restore tab',          commandId: CommandId.TAB_REOPEN    },

  // Scrolling
  { phrase: 'scroll down',          commandId: CommandId.SCROLL_DOWN   },
  { phrase: 'scroll up',            commandId: CommandId.SCROLL_UP     },
  { phrase: 'page down',            commandId: CommandId.SCROLL_DOWN   },
  { phrase: 'page up',              commandId: CommandId.SCROLL_UP     },

  // Zoom
  { phrase: 'zoom in',              commandId: CommandId.ZOOM_IN       },
  { phrase: 'zoom out',             commandId: CommandId.ZOOM_OUT      },
  { phrase: 'reset zoom',           commandId: CommandId.ZOOM_RESET    },
  { phrase: 'zoom reset',           commandId: CommandId.ZOOM_RESET    },

  // Window
  { phrase: 'full screen',          commandId: CommandId.WINDOW_FULLSCREEN  },
  { phrase: 'fullscreen',           commandId: CommandId.WINDOW_FULLSCREEN  },
  { phrase: 'toggle fullscreen',    commandId: CommandId.WINDOW_FULLSCREEN  },
  { phrase: 'minimize window',      commandId: CommandId.WINDOW_MINIMIZE    },
  { phrase: 'minimize',             commandId: CommandId.WINDOW_MINIMIZE    },

  // Bookmarks
  { phrase: 'bookmark this page',   commandId: CommandId.BOOKMARK_ADD  },
  { phrase: 'bookmark this',        commandId: CommandId.BOOKMARK_ADD  },
  { phrase: 'bookmark page',        commandId: CommandId.BOOKMARK_ADD  },
  { phrase: 'save page',            commandId: CommandId.BOOKMARK_ADD  },
  { phrase: 'add bookmark',         commandId: CommandId.BOOKMARK_ADD  },

  // Aliases for speed
  { phrase: 'back',                 commandId: CommandId.NAV_BACK      },
  { phrase: 'forward',              commandId: CommandId.NAV_FORWARD   },
  { phrase: 'home',                 commandId: CommandId.NAV_HOME      },
  { phrase: 'refresh',              commandId: CommandId.NAV_RELOAD    },
  { phrase: 'close',                commandId: CommandId.TAB_CLOSE     },
  { phrase: 'new',                  commandId: CommandId.TAB_NEW       },
];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum confidence to return a match. Below this → no match. */
const MIN_CONFIDENCE = 0.45;

/** Short phrases (≤ 2 words) need a higher overlap score to reduce false positives. */
const SHORT_PHRASE_CONFIDENCE_BOOST = 0.15;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} MatchResult
 * @property {string}  commandId  - The matched CommandId.
 * @property {string}  phrase     - The command phrase that was matched.
 * @property {string}  transcript - The original (raw) transcript.
 * @property {number}  confidence - Match confidence: 0–1.
 * @property {string}  matchType  - 'exact' | 'contains' | 'fuzzy'.
 */

// ---------------------------------------------------------------------------
// VoiceCommandMatcher
// ---------------------------------------------------------------------------

export class VoiceCommandMatcher {
  /**
   * Matches a raw transcript against the built-in command vocabulary.
   *
   * @param {string} rawTranscript - The raw string from SpeechRecognition.
   * @returns {MatchResult | null} - Highest-confidence match, or null.
   */
  match(rawTranscript) {
    if (!rawTranscript || typeof rawTranscript !== 'string') return null;

    const normalized = normalize(rawTranscript);
    if (!normalized) return null;

    log.debug(`Matching: "${normalized}" (raw: "${rawTranscript}")`);

    // Check dynamic prefix commands (e.g. "type hello world")
    const typePrefixes = ['type ', 'write ', 'enter '];
    for (const prefix of typePrefixes) {
      if (normalized.startsWith(prefix)) {
        // Extract the payload, preserving original case if possible
        // We use the raw transcript to preserve case, but we need to find where the prefix ends.
        const lowerRaw = rawTranscript.toLowerCase();
        const prefixIndex = lowerRaw.indexOf(prefix);
        let textPayload = '';
        
        if (prefixIndex !== -1) {
          textPayload = rawTranscript.slice(prefixIndex + prefix.length).trim();
        } else {
          // Fallback if punctuation messed up the raw index
          textPayload = normalized.slice(prefix.length).trim();
        }

        if (textPayload) {
          log.info(`Matched dynamic text command: "${prefix}" → ${textPayload}`);
          return {
            commandId: CommandId.TYPE_TEXT,
            phrase: prefix + '<text>',
            transcript: rawTranscript,
            confidence: 1.0,
            matchType: 'exact',
            text: textPayload
          };
        }
      }
    }

    let bestMatch = null;

    for (const entry of VOICE_COMMANDS) {
      const phraseNorm = normalize(entry.phrase);
      const result     = score(normalized, phraseNorm, entry.commandId);

      if (!result) continue;

      // Keep the highest-confidence match
      if (!bestMatch || result.confidence > bestMatch.confidence) {
        bestMatch = { ...result, transcript: rawTranscript, phrase: entry.phrase };
      }

      // Early exit: exact match can't be beaten
      if (bestMatch.matchType === 'exact') break;
    }

    if (!bestMatch || bestMatch.confidence < MIN_CONFIDENCE) {
      log.debug(`No match for: "${normalized}"`);
      return null;
    }

    log.info(
      `Matched: "${bestMatch.phrase}" → ${bestMatch.commandId} ` +
      `(${bestMatch.matchType}, ${(bestMatch.confidence * 100).toFixed(0)}%)`
    );
    return bestMatch;
  }

  /**
   * Returns the full command vocabulary for display in the settings page.
   * @returns {Readonly<VoiceCommandEntry[]>}
   */
  getVocabulary() {
    return VOICE_COMMANDS;
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes a string for matching:
 *  - Lowercase
 *  - Strip punctuation and special chars
 *  - Collapse multiple spaces to single space
 *  - Trim
 *
 * @param {string} str
 * @returns {string}
 */
function normalize(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')   // remove punctuation
    .replace(/\s+/g, ' ')           // collapse whitespace
    .trim();
}

/**
 * Scores a transcript against a single command phrase.
 *
 * @param {string} transcript - Normalized transcript.
 * @param {string} phrase     - Normalized command phrase.
 * @param {string} commandId
 * @returns {{ commandId: string, confidence: number, matchType: string } | null}
 */
function score(transcript, phrase, commandId) {
  // 1. Exact match
  if (transcript === phrase) {
    return { commandId, confidence: 1.0, matchType: 'exact' };
  }

  // 2. Transcript starts with the phrase exactly
  //    e.g. "go back please" → matches "go back"
  if (transcript.startsWith(phrase)) {
    return { commandId, confidence: 0.95, matchType: 'contains' };
  }

  // 3. Transcript contains the phrase as a whole substring
  if (transcript.includes(phrase)) {
    return { commandId, confidence: 0.88, matchType: 'contains' };
  }

  // 4. Word-overlap fuzzy match
  const phraseWords      = phrase.split(' ');
  const transcriptWords  = new Set(transcript.split(' '));
  let   matchingWords    = 0;

  for (const word of phraseWords) {
    if (transcriptWords.has(word)) matchingWords++;
  }

  if (matchingWords === 0) return null;

  let wordOverlap = matchingWords / phraseWords.length;

  // Penalty for short phrases (≤2 words) — must match all words
  if (phraseWords.length <= 2 && matchingWords < phraseWords.length) {
    return null; // Require 100% match for short phrases
  }

  // Bonus for matching all words in the phrase (just not in order)
  if (matchingWords === phraseWords.length) {
    wordOverlap = Math.min(1, wordOverlap + 0.05);
  }

  const confidence = wordOverlap * 0.8; // fuzzy match caps at 80% confidence
  if (confidence < MIN_CONFIDENCE) return null;

  return { commandId, confidence, matchType: 'fuzzy' };
}
