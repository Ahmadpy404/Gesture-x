import { SpeechEngine } from '../offscreen/voice/SpeechEngine.js';
import { onMessage } from '../shared/MessageBus.js';
import { MessageType } from '../shared/constants.js';
import { createLogger } from '../shared/Logger.js';

const log = createLogger('VoiceTab');

// Initialize the Speech Engine
const speechEngine = new SpeechEngine();

// Listen for START/STOP commands from the Service Worker
onMessage((message) => {
  if (message.type === MessageType.START_SPEECH) {
    log.info('Received START_SPEECH command');
    speechEngine.start();
  } else if (message.type === MessageType.STOP_SPEECH) {
    log.info('Received STOP_SPEECH command');
    speechEngine.stop();
  }
});

// Auto-start on load if the tab was created for speech
log.info('Voice tab initialized');
speechEngine.start();
