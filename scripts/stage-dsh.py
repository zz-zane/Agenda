"""Copy the locked Agenda SDK dependency closure; never modify upstream packages."""
from pathlib import Path
import json
import shutil
import sys


def stage(source, destination):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if destination.exists() or source == destination or source in destination.parents:
        raise ValueError('Use a fresh destination outside the source tree')
    lock = json.loads((source / 'package-lock.json').read_text(encoding='utf-8'))
    packages = lock['packages']
    cli = '@deepseek-ai/dsh'
    sdk = '@deepseek-ai/dsh-sdk-minimal'
    assert packages['node_modules/' + cli]['version'] == '0.1.5-rc.2'
    # These are the CLI profile boot imports, not its Web/ACP/other profile bundles.
    boot = {'@deepseek-ai/dsh-' + name for name in
            ('app-boot', 'home-paths', 'http-proxy', 'launch-environment', 'cmdline', 'sdk-minimal')}
    # Already disabled by dsh_bridge.py. Shared dependencies are retained if reached elsewhere.
    disabled = {'@deepseek-ai/dsh-' + name for name in (
        'tool-bash-persistent', 'tool-pwsh-persistent', 'terminal-bash', 'terminal',
        'subprocess-local', 'llm-retry', 'session-log-deepseek', 'plugin-package-inventory-deepseek')}

    def resolve(parent, name):
        base = Path(parent)
        while True:
            candidate = (base / 'node_modules' / name).as_posix()
            if candidate in packages and (source / candidate / 'package.json').is_file():
                return candidate
            if base == Path('.'):
                return None
            base = base.parent

    keep, pending = set(), ['node_modules/' + cli]
    while pending:
        package = pending.pop()
        if package in keep:
            continue
        keep.add(package)
        metadata = json.loads((source / package / 'package.json').read_text(encoding='utf-8'))
        dependencies = set(metadata.get('dependencies', {}))
        optional = set(metadata.get('optionalDependencies', {}))
        peers = set(metadata.get('peerDependencies', {}))
        if metadata['name'] == cli:
            dependencies = {name for name in dependencies if not name.startswith('@deepseek-ai/dsh-')} | boot
        if metadata['name'] == sdk:
            dependencies -= disabled
        for name in dependencies | optional | peers:
            child = resolve(package, name)
            if child:
                pending.append(child)
            elif name in dependencies - optional:
                raise ValueError('Missing required dependency: ' + name)
    destination.mkdir(parents=True)
    for name in ('package.json', 'package-lock.json', 'agenda-plugin.mjs'):
        shutil.copyfile(source / name, destination / name)
    for package in sorted(keep):
        shutil.copytree(source / package, destination / package,
                        ignore=shutil.ignore_patterns('node_modules'))
    def size(root):
        files = [p for p in root.rglob('*') if p.is_file()]
        return {'files': len(files), 'bytes': sum(p.stat().st_size for p in files)}
    report = {'before': size(source), 'after': size(destination),
              'kept_packages': sorted(keep),
              'removed_packages': sorted(p for p in packages if p and p not in keep
                                         and (source / p / 'package.json').is_file())}
    return report


if __name__ == '__main__':
    report = stage(sys.argv[1], sys.argv[2])
    Path(sys.argv[3]).write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({key: report[key] for key in ('before', 'after')}))
