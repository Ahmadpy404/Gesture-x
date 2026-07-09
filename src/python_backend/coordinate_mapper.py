import ctypes

class CoordinateMapper:
    def __init__(self):
        self.user32 = ctypes.windll.user32
        self.screen_width = self.user32.GetSystemMetrics(0)
        self.screen_height = self.user32.GetSystemMetrics(1)
        
        self.speed = 1.0
        self.smoothing = 0.5  # 0.0 to 1.0 (higher = smoother but more lag)
        self.dead_zone = 0.003 # Normalized coordinate distance to ignore (jitter reduction)
        
        self.last_x = None
        self.last_y = None
        
    def set_speed(self, speed):
        self.speed = speed
        
    def set_smoothing(self, smoothing):
        self.smoothing = smoothing
        
    def map_to_screen(self, norm_x, norm_y):
        # Mirror x-axis since webcam is mirrored
        norm_x = 1.0 - norm_x
        
        # Apply a scale factor so you don't have to reach the absolute edges of the camera
        # Central area of the camera mapped to full screen. We use 2.0x so a small movement covers the whole screen.
        scale = max(1.0, 2.0 * self.speed)
        
        offset_x = (1.0 - 1.0/scale) / 2.0
        offset_y = (1.0 - 1.0/scale) / 2.0
        
        mapped_x = (norm_x - offset_x) * scale
        mapped_y = (norm_y - offset_y) * scale
        
        mapped_x = max(0.0, min(1.0, mapped_x))
        mapped_y = max(0.0, min(1.0, mapped_y))
        
        if self.last_x is None or self.last_y is None:
            self.last_x = mapped_x
            self.last_y = mapped_y
            
        # Dead-zone filtering
        dx = mapped_x - self.last_x
        dy = mapped_y - self.last_y
        dist = (dx**2 + dy**2)**0.5
        
        if dist > self.dead_zone:
            # Dynamic smoothing: lower smoothing for fast movements, higher for slow/precise
            dynamic_smoothing = self.smoothing
            if dist > 0.02:
                dynamic_smoothing = max(0.1, self.smoothing - 0.3)
            elif dist < 0.005:
                dynamic_smoothing = min(0.95, self.smoothing + 0.4)

            alpha = max(0.01, 1.0 - dynamic_smoothing)
            
            smoothed_x = self.last_x + alpha * dx
            smoothed_y = self.last_y + alpha * dy
            
            self.last_x = smoothed_x
            self.last_y = smoothed_y
        else:
            smoothed_x = self.last_x
            smoothed_y = self.last_y
            
        return smoothed_x * self.screen_width, smoothed_y * self.screen_height
