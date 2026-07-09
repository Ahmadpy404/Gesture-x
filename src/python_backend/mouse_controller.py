import ctypes
import time

# Constants for ctypes mouse inputs
MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_ABSOLUTE = 0x8000
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010
MOUSEEVENTF_WHEEL = 0x0800

class MouseController:
    def __init__(self):
        self.user32 = ctypes.windll.user32
        self.screen_width = self.user32.GetSystemMetrics(0)
        self.screen_height = self.user32.GetSystemMetrics(1)
        
        # Track state to avoid repeated down/up events
        self.is_dragging = False
        
    def move_to(self, x, y):
        # Move the cursor using absolute positioning mapped to 0-65535
        # We ensure x and y are within bounds
        x = max(0, min(x, self.screen_width))
        y = max(0, min(y, self.screen_height))
        nx = int(x * 65535 / self.screen_width)
        ny = int(y * 65535 / self.screen_height)
        self.user32.mouse_event(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, nx, ny, 0, 0)
        
    def click(self, button='left'):
        if button == 'left':
            self.user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
            self.user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
        elif button == 'right':
            self.user32.mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0)
            self.user32.mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0)
            
    def scroll(self, amount):
        # amount is number of wheel clicks (positive=forward/up, negative=backward/down)
        # 120 is one standard click unit
        self.user32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, int(amount * 120), 0)

    def drag_start(self):
        if not self.is_dragging:
            self.user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
            self.is_dragging = True
        
    def drag_end(self):
        if self.is_dragging:
            self.user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
            self.is_dragging = False
