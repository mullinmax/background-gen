import json
import subprocess


NODE_SCRIPT = """
import { generateGrainData } from './static/js/noise.js';
import crypto from 'crypto';

const payload = JSON.parse(process.argv[1]);
const result = generateGrainData(
  payload.width,
  payload.height,
  payload.grain,
  payload.baseLightness,
  payload.seed,
);
if (!result) {
  console.log('null');
} else {
  const hash = crypto.createHash('sha256');
  hash.update(Buffer.from(result.data));
  console.log(hash.digest('hex'));
}
""".strip()


BASE_GRAIN = {
  'enabled': True,
  'amount': 65,
  'size': 'normal',
  'algorithm': 'fbm',
  'octaves': 4,
  'lacunarity': 2.0,
  'gain': 0.55,
  'chroma': {'enabled': True, 'intensity': 0.12},
  'intensityCurve': 'linear',
  'protectShadows': 0.0,
}


def grain_hash(grain, base_lightness=0.35, seed=12345):
  payload = json.dumps({
    'width': 48,
    'height': 48,
    'grain': grain,
    'baseLightness': base_lightness,
    'seed': seed,
  })
  result = subprocess.run(
    ['node', '--input-type=module', '-e', NODE_SCRIPT, payload],
    capture_output=True,
    text=True,
    check=True,
  )
  return result.stdout.strip()


def test_grain_amount_changes_output():
  base = json.loads(json.dumps(BASE_GRAIN))
  h1 = grain_hash(base)
  variant = json.loads(json.dumps(BASE_GRAIN))
  variant['amount'] = 20
  h2 = grain_hash(variant)
  assert h1 != h2


def test_grain_size_changes_texture_frequency():
  base = json.loads(json.dumps(BASE_GRAIN))
  h1 = grain_hash(base)
  variant = json.loads(json.dumps(BASE_GRAIN))
  variant['size'] = 'coarse'
  h2 = grain_hash(variant)
  assert h1 != h2


def test_grain_algorithm_alters_pattern():
  base = json.loads(json.dumps(BASE_GRAIN))
  h1 = grain_hash(base)
  variant = json.loads(json.dumps(BASE_GRAIN))
  variant['algorithm'] = 'blue-noise'
  h2 = grain_hash(variant)
  assert h1 != h2


def test_grain_octaves_affect_complexity():
  base = json.loads(json.dumps(BASE_GRAIN))
  h1 = grain_hash(base)
  variant = json.loads(json.dumps(BASE_GRAIN))
  variant['octaves'] = 2
  h2 = grain_hash(variant)
  assert h1 != h2


def test_grain_lacunarity_adjusts_scale_spacing():
  base = json.loads(json.dumps(BASE_GRAIN))
  h1 = grain_hash(base)
  variant = json.loads(json.dumps(BASE_GRAIN))
  variant['lacunarity'] = 1.2
  h2 = grain_hash(variant)
  assert h1 != h2


def test_grain_gain_changes_falloff():
  base = json.loads(json.dumps(BASE_GRAIN))
  h1 = grain_hash(base)
  variant = json.loads(json.dumps(BASE_GRAIN))
  variant['gain'] = 0.85
  h2 = grain_hash(variant)
  assert h1 != h2


def test_grain_chroma_toggle_applies_color():
  base = json.loads(json.dumps(BASE_GRAIN))
  h1 = grain_hash(base)
  variant = json.loads(json.dumps(BASE_GRAIN))
  variant['chroma']['enabled'] = False
  h2 = grain_hash(variant)
  assert h1 != h2


def test_grain_chroma_intensity_scales_tint():
  base = json.loads(json.dumps(BASE_GRAIN))
  base['chroma']['intensity'] = 0.02
  h1 = grain_hash(base)
  variant = json.loads(json.dumps(base))
  variant['chroma']['intensity'] = 0.18
  h2 = grain_hash(variant)
  assert h1 != h2


def test_grain_intensity_curve_modifies_distribution():
  base = json.loads(json.dumps(BASE_GRAIN))
  h1 = grain_hash(base)
  variant = json.loads(json.dumps(BASE_GRAIN))
  variant['intensityCurve'] = 's-curve'
  h2 = grain_hash(variant)
  assert h1 != h2


def test_grain_shadow_protection_reduces_dark_regions():
  base = json.loads(json.dumps(BASE_GRAIN))
  base['protectShadows'] = 0.0
  h1 = grain_hash(base, base_lightness=0.05)
  variant = json.loads(json.dumps(BASE_GRAIN))
  variant['protectShadows'] = 0.18
  h2 = grain_hash(variant, base_lightness=0.05)
  assert h1 != h2


def test_grain_disable_returns_null():
  disabled = json.loads(json.dumps(BASE_GRAIN))
  disabled['enabled'] = False
  assert grain_hash(disabled) == 'null'
