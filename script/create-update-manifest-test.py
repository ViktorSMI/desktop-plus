import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('manifest', Path(__file__).with_name('create-update-manifest.py'))
manifest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manifest)


class ManifestTests(unittest.TestCase):
    def package(self, root, arch, version, identity='DesktopPlus', packaged_version=None):
        path = root / f'DesktopPlus-v{version}-{arch}-full.nupkg'
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr('DesktopPlus.nuspec', f'<package><metadata><id>{identity}</id><version>{packaged_version or manifest.squirrel_version(version)}</version></metadata></package>')
        return path

    def test_numeric_beta_order(self):
        self.assertLess(manifest.squirrel_version('3.6.7-beta9'), manifest.squirrel_version('3.6.7-beta10'))
        self.assertEqual(manifest.squirrel_version('3.6.7'), '3.6.7')
        for bad in ('../../bad', 'v3.6.7-beta1', '3.6.7-beta0', '3.6.7-rc1'):
            with self.assertRaises(ValueError):
                manifest.squirrel_version(bad)

    def test_both_architectures_and_hashes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for arch in ('x64', 'arm64'):
                self.package(root, arch, '3.6.7-beta1')
            result = manifest.generate(root, '3.6.7-beta1')
            self.assertEqual(result['repository'], 'ViktorSMI/desktop-plus')
            self.assertEqual(set(result['windows']), {'x64', 'arm64'})
            self.assertEqual(len(result['windows']['x64']['sha256']), 64)
            self.assertEqual(json.loads((root / 'desktop-plus-updates.json').read_text()), result)

    def test_missing_arch_does_not_publish_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.package(root, 'x64', '3.6.7-beta1')
            with self.assertRaises(FileNotFoundError):
                manifest.generate(root, '3.6.7-beta1')
            self.assertFalse((root / 'desktop-plus-updates.json').exists())

    def test_wrong_identity_and_version_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for identity, version in [('GitHubDesktop', '3.6.7-beta000000001'), ('DesktopPlus', '3.6.7-beta1')]:
                path = self.package(root, 'x64', '3.6.7-beta1', identity, version)
                with self.assertRaises(ValueError):
                    manifest.package_metadata(path, '3.6.7-beta1')


if __name__ == '__main__':
    unittest.main()
