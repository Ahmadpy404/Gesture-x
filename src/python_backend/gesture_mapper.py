import math
import time

class GestureMapper:
    def __init__(self, mouse_controller):
        self.mouse = mouse_controller
        
        self.pinch_threshold = 0.04
        
        self.last_gesture = None
        self.gesture_start_time = 0
        
        self.last_scroll_y = None
        self.scroll_speed = 5.0

    def detect_gesture(self, landmarks, ml_category, ml_score):
        if not landmarks or len(landmarks) < 21:
            return None
            
        # 1. Detect Pinch (Thumb tip = 4, Index tip = 8)
        thumb_tip = landmarks[4]
        index_tip = landmarks[8]
        dist = math.sqrt((thumb_tip['x'] - index_tip['x'])**2 + 
                         (thumb_tip['y'] - index_tip['y'])**2 + 
                         (thumb_tip['z'] - index_tip['z'])**2)
                         
        if dist < self.pinch_threshold:
            return 'Pinch'
            
        # 2. Detect Three Fingers (Index, Middle, Ring extended; Thumb and Pinky curled/down)
        index_up = landmarks[8]['y'] < landmarks[6]['y']
        middle_up = landmarks[12]['y'] < landmarks[10]['y']
        ring_up = landmarks[16]['y'] < landmarks[14]['y']
        pinky_down = landmarks[20]['y'] > landmarks[18]['y']
        
        if index_up and middle_up and ring_up and pinky_down:
            return 'ThreeFingers'
            
        # 3. Fallback to ML Category
        if ml_score and ml_score > 0.6:
            if ml_category == 'Closed_Fist':
                return 'Fist'
            elif ml_category == 'Victory':
                return 'Peace'
            elif ml_category == 'Thumb_Up':
                return 'ThumbUp'
            elif ml_category == 'Open_Palm':
                return 'OpenPalm'
                
        return 'IndexMove'

    def execute_gesture(self, gesture, x, y):
        # Handle dragging state
        if gesture == 'ThreeFingers':
            if self.last_gesture != 'ThreeFingers':
                self.mouse.drag_start()
            self.mouse.move_to(x, y)
        else:
            if self.last_gesture == 'ThreeFingers':
                self.mouse.drag_end()

        # Pause Cursor
        if gesture == 'OpenPalm':
            self.last_gesture = gesture
            return

        # Move Mouse
        if gesture not in ['ThreeFingers', 'Peace', 'OpenPalm', 'Pinch']:
            self.mouse.move_to(x, y)

        # Handle Scroll
        if gesture == 'Peace':
            if self.last_gesture != 'Peace':
                self.last_scroll_y = y
            else:
                dy = y - self.last_scroll_y
                # If dy is negative, hand moved UP, scroll UP (positive amount)
                if abs(dy) > 5:  # small deadzone for scrolling
                    self.mouse.scroll(-dy / 10.0 * self.scroll_speed)
                    self.last_scroll_y = y

        # Handle Discrete Clicks (Only trigger when transitioning INTO the gesture)
        if gesture != self.last_gesture:
            # We want a small debounce/cooldown for clicks to avoid double triggering?
            # Actually, simply checking gesture transition is usually enough.
            if gesture == 'Pinch':
                self.mouse.click('left')
            elif gesture == 'Fist':
                self.mouse.click('right')
            elif gesture == 'ThumbUp':
                self.mouse.click('left')
                self.mouse.click('left')
                
        self.last_gesture = gesture
