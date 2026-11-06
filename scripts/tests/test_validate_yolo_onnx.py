"""Pure synthetic ONNX contract tests: no downloaded model or training data."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import onnx
from onnx import TensorProto, helper

from scripts.validate_yolo_onnx import ModelValidationError, validate_model


def make_fixture(path: Path, *, input_shape=(1, 3, 640, 640),
                 output_shape=(1, 84, 8400), names=True, wrong_label=False,
                 with_nms=False, external=False) -> None:
    image = helper.make_tensor_value_info("images", TensorProto.FLOAT, list(input_shape))
    output = helper.make_tensor_value_info("raw_detections", TensorProto.FLOAT, list(output_shape))
    shape = helper.make_tensor("shape", TensorProto.INT64, [3], [1, 84, 8400])
    nodes = [helper.make_node("ConstantOfShape", ["shape"], ["raw_detections"])]
    if with_nms:
        # Validator intentionally rejects even a well-formed graph containing
        # a built-in NonMaxSuppression node; the app implements its own NMS.
        boxes = helper.make_tensor_value_info("boxes", TensorProto.FLOAT, [1, 1, 4])
        scores = helper.make_tensor_value_info("scores", TensorProto.FLOAT, [1, 1, 1])
        nodes.append(helper.make_node("NonMaxSuppression", ["boxes", "scores"], ["indices"]))
        graph = helper.make_graph(nodes, "fixture", [image, boxes, scores], [output])
    else:
        graph = helper.make_graph(nodes, "fixture", [image], [output], initializer=[shape])
    if with_nms:
        graph.initializer.append(shape)
        graph.value_info.append(helper.make_tensor_value_info("indices", TensorProto.INT64, [None, 3]))
    model = helper.make_model(graph, producer_name="visionguard-synthetic-test",
                              opset_imports=[helper.make_operatorsetid("", 17)])
    model.ir_version = 9
    if names:
        labels = {i: f"other_{i}" for i in range(80)}
        labels.update({0: "person", 1: "bicycle", 2: "car", 3: "motorcycle", 5: "bus", 7: "truck"})
        if wrong_label:
            labels[2] = "truck"
        model.metadata_props.add(key="names", value=str(labels))
    if external:
        # ONNX only saves an initializer externally when it contains raw_data.
        # A float_data tensor with data_location manually set is normalized by
        # the serializer and would not exercise the validator's external guard.
        tensor = helper.make_tensor(
            "external_weights", TensorProto.FLOAT, [1],
            b"\\x00\\x00\\x80\\x3f", raw=True
        )
        graph.initializer.append(tensor)
        onnx.save_model(
            model, path, save_as_external_data=True,
            all_tensors_to_one_file=True, size_threshold=0,
            location="external.bin"
        )
        return
    onnx.save(model, path)


class TestYOLOModelContract(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "model.onnx"

    def test_valid_static_80_class_output(self):
        make_fixture(self.path)
        report = validate_model(self.path)
        self.assertTrue(report["ok"])
        self.assertEqual(report["input_shape"], [1, 3, 640, 640])
        self.assertEqual(report["output_shape"], [1, 84, 8400])
        self.assertEqual(len(report["sha256"]), 64)

    def test_missing_model_and_spa_fallback(self):
        with self.assertRaisesRegex(ModelValidationError, "not found"):
            validate_model(self.path)
        self.path.write_text("<!doctype html><html>SPA fallback</html>", encoding="utf-8")
        with self.assertRaisesRegex(ModelValidationError, "HTML"):
            validate_model(self.path)

    def test_wrong_output_shape_is_rejected(self):
        make_fixture(self.path, output_shape=(1, 85, 8400))
        with self.assertRaisesRegex(ModelValidationError, "Wrong output shape"):
            validate_model(self.path)

    def test_dynamic_input_is_rejected(self):
        make_fixture(self.path, input_shape=(None, 3, 640, 640))
        with self.assertRaisesRegex(ModelValidationError, "Wrong input shape"):
            validate_model(self.path)

    def test_wrong_traffic_class_mapping_is_rejected(self):
        make_fixture(self.path, wrong_label=True)
        with self.assertRaisesRegex(ModelValidationError, "COCO class 2"):
            validate_model(self.path)

    def test_missing_names_requires_explicit_opt_out(self):
        make_fixture(self.path, names=False)
        with self.assertRaisesRegex(ModelValidationError, "Missing COCO"):
            validate_model(self.path)
        self.assertFalse(validate_model(self.path, allow_missing_names=True)["class_metadata_checked"])

    def test_rejects_external_weights(self):
        make_fixture(self.path, external=True)
        with self.assertRaises(ModelValidationError):
            validate_model(self.path)


if __name__ == "__main__":
    unittest.main()
