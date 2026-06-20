"""Offline evaluation / benchmark harness for the CV analyzer.

Kept separate from `app/` so it never ships in the runtime image (the Dockerfile
only copies `app/`). Reuses the real pipeline modules so the benchmark measures
exactly what production runs.
"""
