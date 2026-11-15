"""Offline verification of pinned, public V4.1 text-only prompt assets.

No model request, credentials, remote-code loader, download, or asset copy occurs.
The official encoder remains in the caller's cache with its MIT license.
"""
import argparse
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True

PINS = {
    "current-tokenizer.json": "c90dfa01249db1be4245780a052ede752e1361c612ac6d08e2bdada7d599476b",
    "current-tokenizer_config.json": "6ac8c8dc065ed118161d02dd532749ae3f52c243deac27872134fae2f50d8547",
    "current-encoding-encoding.py": "13231c592e958fb39e2af6001dae69d90e7a36b265702b9b390236fb387599e2",
    "current-encoding-README.md": "a34a5ca98c65e5b5b2bedd693cc2e18e732fe50192723fb6937ae07219c23739",
    "current-LICENSE": "f2c6c602815669d292889e5be8c802f2ed950653b77999b1584e8e6aed25d040",
}


def check(condition):
    if not condition:
        raise ValueError("OFFLINE_TOKEN_PROOF_FAILED")


def audit_encoder(source):
    tree = ast.parse(source)
    imports = set()
    forbidden = {"eval", "exec", "__import__", "compile", "getattr", "setattr"}
    for item in ast.walk(tree):
        if isinstance(item, ast.Import):
            imports.update(name.name for name in item.names)
        elif isinstance(item, ast.ImportFrom):
            imports.add(item.module)
        elif isinstance(item, ast.Call) and isinstance(item.func, ast.Name):
            check(item.func.id not in forbidden)
    check(imports == {"typing", "copy", "json", "re"})
    # The fixed hash is the security boundary. This extra audit rejects unexpected
    # module-level executable statements before importing that reviewed source.
    allowed = (ast.Expr, ast.Import, ast.ImportFrom, ast.Assign, ast.AnnAssign,
               ast.FunctionDef)
    check(all(isinstance(item, allowed) for item in tree.body))
    check(all(not isinstance(item, ast.Expr) or isinstance(item.value, ast.Constant)
              for item in tree.body))


def validate_payload(payload_json):
    check(isinstance(payload_json, str) and len(payload_json.encode("utf8")) <= 65536)
    payload = json.loads(payload_json)
    check(set(payload) == {"model", "messages", "thinking", "stream", "max_tokens", "response_format"})
    check(payload["model"] == "deepseek-flash" and payload["thinking"] == {"type": "disabled"})
    check(payload["stream"] is False and payload["max_tokens"] == 4096)
    check(payload["response_format"] == {"type": "json_object"})
    messages = payload["messages"]
    check(isinstance(messages, list) and len(messages) == 2)
    for message, role in zip(messages, ["system", "user"]):
        check(set(message) == {"role", "content"} and message["role"] == role)
        check(isinstance(message["content"], str) and message["content"])
        check("<｜deepseek_image｜>" not in message["content"])
    return payload


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset-dir", required=True)
    args = parser.parse_args()
    root = Path(args.asset_dir).resolve(strict=True)
    assets = {}
    for filename, expected in PINS.items():
        candidate = (root / filename).resolve(strict=True)
        check(candidate.parent == root and candidate.is_file())
        data = candidate.read_bytes()
        check(hashlib.sha256(data).hexdigest() == expected)
        assets[filename] = data
    source = assets["current-encoding-encoding.py"].decode("utf8")
    audit_encoder(source)
    configuration = json.loads(assets["current-tokenizer_config.json"])
    check(configuration["model_max_length"] == 1048576)
    tokenizer_json = json.loads(assets["current-tokenizer.json"])
    check(tokenizer_json["model"]["type"] == "BPE")
    check(tokenizer_json["normalizer"] == {"type": "Sequence", "normalizers": []})
    pretokenizer = tokenizer_json["pre_tokenizer"]
    check(pretokenizer["type"] == "Sequence" and len(pretokenizer["pretokenizers"]) == 4)
    check(all(step["type"] == "Split" and step["behavior"] == "Isolated" and step["invert"] is False
              for step in pretokenizer["pretokenizers"][:-1]))
    check(pretokenizer["pretokenizers"][-1] == {
        "type": "ByteLevel", "add_prefix_space": False, "trim_offsets": True, "use_regex": False})
    check(tokenizer_json["truncation"] is None)
    raw = sys.stdin.buffer.read(65537)
    check(len(raw) <= 65536)
    payload_json = raw.decode("utf8")
    payload = validate_payload(payload_json)

    # Pinned, audited official source; no trust_remote_code or model loading.
    spec = importlib.util.spec_from_file_location("bilingual_official_v41_encoding", root / "current-encoding-encoding.py")
    check(spec is not None and spec.loader is not None)
    encoder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(encoder)
    import tokenizers
    tokenizer = tokenizers.Tokenizer.from_file(str(root / "current-tokenizer.json"))
    for _ in [0]:
        # Count both the submitted messages and the official encoder's documented
        # response-format rendering, without changing the actual submitted payload.
        messages_with_format = [dict(message) for message in payload["messages"]]
        messages_with_format[0]["response_format"] = payload["response_format"]
        prompts = [encoder.encode_messages(messages, thinking_mode="chat")
                   for messages in [payload["messages"], messages_with_format]]
        for prompt in prompts:
            check(isinstance(prompt, str) and prompt.startswith(encoder.bos_token))
            check(prompt.endswith(encoder.ASSISTANT_SP_TOKEN + encoder.thinking_end_token))
            check(encoder.thinking_start_token not in prompt)
        counts = [len(tokenizer.encode(prompt, add_special_tokens=False).ids) for prompt in prompts]
        byte_bounds = [len(prompt.encode("utf8")) for prompt in prompts]
        check(all(0 < count <= byte_bound for count, byte_bound in zip(counts, byte_bounds)))
        result = {
            "payloadSha256": hashlib.sha256(payload_json.encode("utf8")).hexdigest(),
            "officialTemplateTokens": counts[0],
            "officialTemplateWithResponseFormatTokens": counts[1],
            "renderedUtf8ByteUpperBound": max(byte_bounds),
            "inputTokensUpperBound": max(byte_bounds),
        }
    check(tokenizers.__version__ == "0.22.2")
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("OFFLINE_TOKEN_PROOF_FAILED NO_API_NO_SECRET", file=sys.stderr)
        sys.exit(1)
