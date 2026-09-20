"""Generate the pinned-fork updater manifest only after both Windows builds exist.

No private signing material or GitHub tokens are written to the manifest.
The client authenticates the source via HTTPS and verifies SHA-256 before Squirrel.
"""
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree

REPOSITORY = 'ViktorSMI/desktop-plus'
MAX_PACKAGE_BYTES = 2 * 1024 * 1024 * 1024


def squirrel_version(version):
    match = re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta([1-9]\d{0,8}))?', version)
    if not match:
        raise ValueError('Invalid release version')
    base = '.'.join(match.group(i) for i in (1, 2, 3))
    return base if match.group(4) is None else base + '-beta' + match.group(4).zfill(9)


def package_metadata(path, version):
    with zipfile.ZipFile(path) as archive:
        specs = [entry for entry in archive.infolist() if entry.filename.endswith('.nuspec')]
        if len(specs) != 1 or specs[0].file_size > 64 * 1024:
            raise ValueError('Expected exactly one bounded NuGet specification')
        specification = ElementTree.fromstring(archive.read(specs[0]))
        metadata = next((node for node in specification if node.tag.split('}')[-1] == 'metadata'), None)
        if metadata is None:
            raise ValueError('Missing NuGet metadata')
        fields = {node.tag.split('}')[-1]: node.text for node in metadata}
        if fields.get('id') != 'DesktopPlus' or fields.get('version') != squirrel_version(version):
            raise ValueError('Unexpected NuGet identity or version: ' + str(fields))
    size = path.stat().st_size
    if not 0 < size <= MAX_PACKAGE_BYTES:
        raise ValueError('Invalid update package size')
    sha256 = hashlib.sha256()
    sha1 = hashlib.sha1()
    with path.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            sha256.update(chunk)
            sha1.update(chunk)
    return dict(name=path.name, size=size, sha256=sha256.hexdigest(), sha1=sha1.hexdigest(), squirrelVersion=squirrel_version(version))


def generate(assets, version):
    squirrel_version(version)
    windows = {}
    for arch in ('x64', 'arm64'):
        path = assets / f'DesktopPlus-v{version}-{arch}-full.nupkg'
        windows[arch] = package_metadata(path, version)
    result = dict(schemaVersion=1, repository=REPOSITORY, version=version, windows=windows)
    target = assets / 'desktop-plus-updates.json'
    temporary = target.with_suffix('.partial')
    temporary.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    temporary.replace(target)
    return result


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: create-update-manifest.py ASSET_DIRECTORY VERSION')
    generate(Path(sys.argv[1]), sys.argv[2])
