"""Run the existing AI/DSH regressions against only the staged runtime."""
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import dsh_bridge


if __name__ == '__main__':
    runtime = Path(sys.argv[1]).resolve()
    original = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else ROOT / 'dsh'
    files = [p for p in runtime.rglob('*') if p.is_file()]
    for file in files:
        assert file.read_bytes() == (original / file.relative_to(runtime)).read_bytes(), file.name
    for name in ('dsh-web-app', 'dsh-acp-app', 'dsh-terminal', 'dsh-tool-subagent',
                 'dsh-session-log-deepseek', 'dsh-llm-retry'):
        assert not (runtime / 'node_modules/@deepseek-ai' / name).exists(), name
    with tempfile.TemporaryDirectory(prefix='agenda-slim-check-') as directory:
        dsh_bridge.ROOT = Path(directory)
        shutil.copytree(runtime, dsh_bridge.ROOT / 'dsh')
        result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.discover(str(ROOT / 'tests')))
        sys.exit(not result.wasSuccessful())
