"""Build only explicit application inputs; never package a workspace or user data."""
from pathlib import Path
import hashlib
import importlib.metadata
import json
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / '.preview' / 'windows-build'


def run(*args, cwd=ROOT):
    subprocess.run([str(arg) for arg in args], cwd=cwd, check=True, timeout=1200)


def stage_licenses(source):
    destination = source / 'licenses'
    destination.mkdir(exist_ok=True)
    shutil.copyfile(Path(sys.base_prefix) / 'LICENSE.txt', destination / 'Python.txt')
    for name in ('Pillow', 'openpyxl', 'et-xmlfile', 'PyInstaller', 'numpy', 'sherpa-onnx', 'sherpa-onnx-core', 'sounddevice', 'cffi'):
        distribution = importlib.metadata.distribution(name)
        for file in distribution.files:
            if file.name.upper().startswith(('LICENSE', 'LICENCE', 'COPYING')):
                shutil.copyfile(distribution.locate_file(file), destination / (name + '-' + file.name))


def main():
    if sys.platform != 'win32':
        raise SystemExit('Build on Windows x64 with Python, Node and PyInstaller installed.')
    import PyInstaller
    BUILD.mkdir(parents=True, exist_ok=True)
    source = BUILD / 'source'
    if source.exists():
        # Only this script's staging directory is replaced, after checking its boundary.
        assert source.resolve().parent == BUILD.resolve() and not source.is_symlink()
        shutil.rmtree(source)
    source.mkdir()
    stage_licenses(source)
    for name in ('desktop_host.py', 'desktop_pet.py', 'local_server.py', 'local_ai.py', 'local_profile.py',
                 'local_secrets.py', 'local_schedule.py', 'local_context.py', 'desktop_tools.py', 'dsh_bridge.py', 'ai_rules.md', 'LICENSE', 'LICENSE-Swarm-MIT.txt'):
        shutil.copyfile(ROOT / name, source / name)
    for name in ('frontend', 'ai_skills'):
        for file in (ROOT / name).rglob('*'):
            if file.is_file() and file.suffix in ('.js', '.css', '.html', '.svg', '.md'):
                target = source / file.relative_to(ROOT)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(file, target)
    shutil.copytree(ROOT / 'agenda_pet', source / 'agenda_pet', ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    if not (source / 'agenda_pet/models/sensevoice/model.int8.onnx').is_file():
        raise SystemExit('Local voice models missing: see agenda_pet/README.md before building.')
    dsh = source / 'dsh'
    dsh.mkdir()
    for name in ('package.json', 'package-lock.json', 'agenda-plugin.mjs'):
        shutil.copyfile(ROOT / 'dsh' / name, dsh / name)
    npm = shutil.which('npm.cmd')
    if not npm:
        raise SystemExit('npm.cmd is required on the build machine.')
    run(npm, 'ci', '--prefix', dsh, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund',
        '--cache', ROOT / '.preview' / 'npm-cache')
    run(sys.executable, ROOT / 'scripts' / 'stage-dsh.py', dsh, source / 'dsh-slim', BUILD / 'dsh-slim-report.json')
    run(sys.executable, ROOT / 'scripts' / 'check-dsh-slim.py', source / 'dsh-slim', dsh)
    for file in source.rglob('*'):
        if file.is_file() and 'node_modules' not in file.parts:
            if file.suffix in ('.db', '.dpapi', '.xlsx', '.key', '.pem') or file.name.startswith('.env'):
                raise SystemExit('Private input rejected: ' + file.name)
    shutil.copyfile(ROOT / 'desktop' / 'assets' / 'agenda.ico', BUILD / 'agenda.ico')
    command = [sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--console',
               '--name', 'AgendaBackend', '--distpath', BUILD / 'backend', '--workpath', BUILD / 'pyinstaller',
               '--specpath', BUILD, '--icon', BUILD / 'agenda.ico']
    command += ['--add-data', str(source / 'agenda_pet' / 'assets') + ';agenda_pet/assets']
    command += ['--add-data', str(source / 'agenda_pet' / 'models') + ';agenda_pet/models', '--collect-all', 'sherpa_onnx']
    for name in ('frontend', 'ai_skills', 'ai_rules.md'):
        command += ['--add-data', str(source / name) + ';' + ('.' if name == 'ai_rules.md' else name)]
    command += [source / 'desktop_host.py']
    run(*command, cwd=source)
    run(npm, 'ci', '--prefix', ROOT / 'desktop', '--no-audit', '--no-fund', '--cache', ROOT / '.preview' / 'npm-cache')
    run(shutil.which('node'), ROOT / 'desktop' / 'node_modules' / 'electron' / 'install.js')
    run(npm, 'run', 'dist', cwd=ROOT / 'desktop')
    version = json.loads((ROOT / 'desktop' / 'package.json').read_text(encoding='utf-8'))['version']
    output = ROOT / 'dist' / 'windows'
    assert (output / 'win-unpacked/resources/backend/_internal/dsh/node_modules/@deepseek-ai/dsh/package.json').is_file(), 'Bundled DSH missing'
    installer = output / f'Agenda-Setup-{version}-x64.exe'
    digest = hashlib.sha256(installer.read_bytes()).hexdigest()
    (output / 'SHA256SUMS.txt').write_text(f'{digest}  {installer.name}\n', encoding='utf-8')
    for name in ('builder-debug.yml',):
        file = output / name
        if file.exists():
            file.replace(BUILD / name)
    print(json.dumps({'installer': installer.name, 'sha256': digest, 'python': sys.version.split()[0],
                      'pyinstaller': PyInstaller.__version__}))


if __name__ == '__main__':
    main()
