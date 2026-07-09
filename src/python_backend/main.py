import sys
import json
import struct
from mouse_controller import MouseController
from coordinate_mapper import CoordinateMapper
from gesture_mapper import GestureMapper

def get_message():
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        return None
    message_length = struct.unpack('@I', raw_length)[0]
    message = sys.stdin.buffer.read(message_length).decode('utf-8')
    return json.loads(message)

def send_message(message_content):
    encoded_content = json.dumps(message_content).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('@I', len(encoded_content)))
    sys.stdout.buffer.write(encoded_content)
    sys.stdout.buffer.flush()

def main():
    mouse = MouseController()
    coord_mapper = CoordinateMapper()
    gesture_mapper = GestureMapper(mouse)

    send_message({"status": "ready"})

    while True:
        msg = get_message()
        if msg is None:
            break
        
        # Process settings updates
        if 'settings' in msg:
            settings = msg['settings']
            if 'cursorSpeed' in settings:
                coord_mapper.set_speed(settings['cursorSpeed'])
            if 'cursorSmoothing' in settings:
                coord_mapper.set_smoothing(settings['cursorSmoothing'])
            
        # Process landmarks
        if 'landmarks' in msg:
            landmarks = msg['landmarks']
            if not landmarks:
                continue
                
            # Assume landmarks is a list of {x, y, z} dicts
            # MediaPipe hands has 21 landmarks
            
            # Map index finger MCP (landmark 5) to screen coordinates for jitter-free tracking
            target_pt = landmarks[5]
            target_x, target_y = coord_mapper.map_to_screen(target_pt['x'], target_pt['y'])
            
            ml_category = msg.get('mlCategory', '')
            ml_score = msg.get('mlScore', 0.0)
            
            # Process gestures for clicks
            gesture = gesture_mapper.detect_gesture(landmarks, ml_category, ml_score)
            gesture_mapper.execute_gesture(gesture, target_x, target_y)

if __name__ == '__main__':
    main()
