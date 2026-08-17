#!/usr/bin/env python3
"""Run the upload API: python -m app"""

import uvicorn

from . import config

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=config.HOST,
        port=config.PORT,
        reload=config.RELOAD,
    )
