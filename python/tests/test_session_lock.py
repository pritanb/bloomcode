from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from bloom_tutor.session_lock import session_lock


class SessionLockTests(unittest.TestCase):
    def test_exclusive_access_and_release(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            with session_lock(root):
                with self.assertRaises(RuntimeError):
                    with session_lock(root):
                        pass
            with session_lock(root):
                pass


if __name__ == "__main__":
    unittest.main()
