import os
import json
import winreg

def install():
    print("--- GestureX Virtual Mouse Host Installer ---")
    ext_id = input("Enter your Chrome Extension ID: ").strip()
    
    if not ext_id:
        print("Error: Extension ID is required.")
        return
        
    dir_path = os.path.dirname(os.path.abspath(__file__))
    
    # 1. Create run_host.bat
    bat_path = os.path.join(dir_path, 'run_host.bat')
    with open(bat_path, 'w') as f:
        f.write('@echo off\ncall python "%~dp0main.py"\n')
        
    # 2. Create host.json
    host_json_path = os.path.join(dir_path, 'host.json')
    host_config = {
        "name": "com.gesturex.mouse",
        "description": "GestureX Virtual Mouse Host",
        "path": bat_path,
        "type": "stdio",
        "allowed_origins": [f"chrome-extension://{ext_id}/"]
    }
    with open(host_json_path, 'w') as f:
        json.dump(host_config, f, indent=2)
        
    # 3. Add to Registry
    key_path = r"Software\Google\Chrome\NativeMessagingHosts\com.gesturex.mouse"
    try:
        key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, key_path)
        winreg.SetValueEx(key, "", 0, winreg.REG_SZ, host_json_path)
        winreg.CloseKey(key)
        print("Successfully installed Native Messaging Host to Registry!")
        print(f"Registry Key: HKCU\\{key_path}")
        print(f"Manifest Path: {host_json_path}")
    except Exception as e:
        print(f"Failed to write to registry: {e}")

if __name__ == "__main__":
    install()
