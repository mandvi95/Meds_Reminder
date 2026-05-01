import sys
import os

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from app import app

if __name__ == '__main__':
    print("\n  MyCare is starting...")
    print("  Visit: http://localhost:8080\n")
    app.run(debug=True, port=8080, use_reloader=False)
