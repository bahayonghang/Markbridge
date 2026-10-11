import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectNativeArtifact } from './native-build.mjs';

test('native artifact scanner rejects machine paths and secrets in ASCII and UTF-16', () => {
  for (const encoding of ['utf8', 'utf16le']) {
    for (const value of ['D:\\agent\\project\\source.rs', 'C:/Users/example/source.rs', '-----BEGIN PRIVATE KEY-----', `sk-${'x'.repeat(24)}`]) {
      assert.throws(() => inspectNativeArtifact(Buffer.from(value, encoding)), /Native artifact contains/);
    }
    inspectNativeArtifact(Buffer.from('/workspace/crates/core/src/lib.rs\0/cargo-home/registry/src/dependency.rs', encoding));
  }
});
