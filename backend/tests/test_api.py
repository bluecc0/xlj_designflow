"""
Deprecated standalone script.

This repo now uses the APIMart async image flow implemented in backend/ai_image.py:
- POST /v1/uploads/images
- POST /v1/images/generations
- GET  /v1/tasks/{task_id}

Use the main app and browser flow for verification instead of this script.
"""

if __name__ == "__main__":
    print("This standalone script is deprecated. Please test image generation through the app.")
