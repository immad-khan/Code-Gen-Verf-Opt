import gzip
import json
import os
import urllib.request

DATASETS = {
    "humaneval_plus": {
        "url": "https://github.com/evalplus/humanevalplus_release/releases/download/v0.1.10/HumanEvalPlus.jsonl.gz",
        "dest": "data/humaneval_plus.jsonl",
        "expected_count": 164
    },
    "mbpp_plus": {
        "url": "https://github.com/evalplus/mbppplus_release/releases/download/v0.2.0/MbppPlus.jsonl.gz",
        "dest": "data/mbpp_plus.jsonl",
        "expected_count": 399
    }
}

def main():
    os.makedirs("data", exist_ok=True)
    for name, info in DATASETS.items():
        print(f"--> Downloading {name} from {info['url']}...")
        gz_path = f"data/{name}.jsonl.gz"
        urllib.request.urlretrieve(info["url"], gz_path)
        
        print(f"--> Decompressing {gz_path} to {info['dest']}...")
        with gzip.open(gz_path, "rt", encoding="utf-8") as gz_in, open(info["dest"], "w", encoding="utf-8") as out:
            lines = [line.strip() for line in gz_in if line.strip()]
            for line in lines:
                out.write(line + "\n")
                
        print(f"[OK] {name} saved! Total problems: {len(lines)} (Expected: {info['expected_count']})")
        if len(lines) != info["expected_count"]:
            print(f"[WARN] Count mismatch for {name}: {len(lines)} != {info['expected_count']}")
        else:
            print(f"[VERIFIED] {name} matches expected count {info['expected_count']} exactly!")

if __name__ == "__main__":
    main()
