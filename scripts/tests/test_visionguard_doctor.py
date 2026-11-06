"""Run model-readiness checks without secret exposure or external dependencies."""
import tempfile
import unittest
from pathlib import Path

from scripts.visionguard_doctor import _environment, diagnose


class TestDoctor(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "apps/web").mkdir(parents=True)
        (self.root / "backend").mkdir()
        (self.root / "apps/web/package.json").write_text("{}", encoding="utf-8")
        (self.root / "backend/requirements.txt").write_text("", encoding="utf-8")

    def test_ci_skips_unavailable_model_and_secrets(self):
        result = diagnose(self.root, ci=True)
        by_name = {c["check"]: c for c in result}
        self.assertEqual(by_name["repository"]["status"], "PASS")
        self.assertEqual(by_name["YOLO ONNX"]["status"], "SKIP")
        self.assertEqual(by_name["Supabase"]["status"], "SKIP")
        self.assertTrue(all(check["status"] != "FAIL" for check in result))

    def test_local_run_explains_missing_model_and_configuration(self):
        checks = {c["check"]: c for c in diagnose(self.root)}
        self.assertEqual(checks["YOLO ONNX"]["status"], "FAIL")
        self.assertEqual(checks["Supabase"]["status"], "FAIL")
        self.assertIn("Run the export workflow", checks["YOLO ONNX"]["detail"])

    def test_secret_values_never_appear_in_output(self):
        fake_secret = "never-show-this-secret-value-ever"
        (self.root / ".env").write_text(
            "VITE_SUPABASE_URL=https://test.supabase.co\n"
            + "VITE_SUPABASE_ANON_KEY=" + fake_secret + "ABCDEFGHIJK\n",
            encoding="utf-8"
        )
        values = _environment(self.root / ".env")
        self.assertTrue(values["VITE_SUPABASE_ANON_KEY"].startswith(fake_secret))
        combined_output = str(diagnose(self.root, ci=True))
        self.assertNotIn(fake_secret, combined_output)
        self.assertNotIn("test.supabase.co", combined_output)


if __name__ == "__main__":
    unittest.main()
