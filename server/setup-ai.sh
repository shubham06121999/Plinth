#!/bin/bash
# Downloads the open models Plinth uses on this Mac (Apple Silicon). About 6 GB in all.
#   FLUX.2-klein-4B 4-bit (photographs), Depth-Anything-V2-Small (camera depth), Kokoro-82M (voice). All Apache 2.0.
set -e
cd "$(dirname "$0")/.."
command -v uv >/dev/null || brew install uv
[ -d ai ] || uv venv --python 3.12 ai
uv pip install --python ai/bin/python mflux
HF_HOME="$PWD/models/hf" ai/bin/python -c "from huggingface_hub import snapshot_download as d; d('Runpod/FLUX.2-klein-4B-mflux-4bit')"
get() { mkdir -p "models/$1/$(dirname "$2")"; [ -s "models/$1/$2" ] || curl -fL -o "models/$1/$2" "https://huggingface.co/$1/resolve/main/$2"; }
for f in config.json preprocessor_config.json onnx/model.onnx; do get onnx-community/depth-anything-v2-small $f; done
for f in config.json tokenizer.json tokenizer_config.json onnx/model.onnx; do get onnx-community/Kokoro-82M-v1.0-ONNX $f; done
echo "Ready. Restart Plinth."
