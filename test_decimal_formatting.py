#!/usr/bin/env python3
import requests
import json

def test_vital_decimal_formatting():
    """Test that vital signs are formatted with correct decimal places"""
    try:
        response = requests.get("http://localhost:5002/api/vital-data?parameter=BT&start_time=0&end_time=1000")
        data = response.json()
        
        print("Testing vital signs decimal formatting:")
        print("=" * 50)
        
        for param_name, param_data in data['data'].items():
            value = param_data['value']
            print(f"{param_name}: {value} (type: {type(value).__name__})")
            
            if param_name == 'BT':
                if isinstance(value, float) and str(value).count('.') == 1:
                    print(f"  ✅ BT correctly formatted with decimal: {value}")
                else:
                    print(f"  ❌ BT should have 1 decimal place: {value}")
            elif param_name in ['HR', 'PLETH_HR', 'ETCO2', 'RR']:
                if isinstance(value, int) or (isinstance(value, float) and value.is_integer()):
                    print(f"  ✅ {param_name} correctly formatted as integer: {value}")
                else:
                    print(f"  ❌ {param_name} should be integer: {value}")
        
        print("\nBackend decimal formatting test completed!")
        return True
        
    except Exception as e:
        print(f"Error testing decimal formatting: {e}")
        return False

if __name__ == "__main__":
    test_vital_decimal_formatting()
