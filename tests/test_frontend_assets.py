from pathlib import Path
import re


def test_context_helper_is_canvas_only():
    context_path = Path('static/js/context.js')
    assert context_path.exists(), 'Canvas context helper should exist'
    content = context_path.read_text('utf-8')
    lowered = content.lower()
    assert 'createcanvas2dcontext' in lowered
    assert "getcontext('2d'" in lowered or 'getcontext("2d"' in lowered
    assert 'webgl' not in lowered


def test_renderer_avoids_webgl_references():
    renderer_path = Path('static/js/renderer.js')
    content = renderer_path.read_text('utf-8').lower()
    assert 'webgl' not in content


def test_renderer_uses_legacy_friendly_hsla_syntax():
    renderer_path = Path('static/js/renderer.js')
    content = renderer_path.read_text('utf-8')
    assert 'hsla(${hue},' in content
    assert 'hsl(${baseHue},' in content


def test_index_includes_render_pipeline_controls():
    index_path = Path('static/index.html')
    content = index_path.read_text('utf-8')
    assert 'id="render-button"' in content
    assert 'id="download-button"' in content
    assert 'id="render-status"' in content


def test_controls_sections_allow_multiple_open():
    controls_path = Path('static/js/controls.js')
    content = controls_path.read_text('utf-8')
    assert 'dataset.bsParent' not in content


def test_controls_sections_expose_effect_toggles():
    controls_path = Path('static/js/controls.js')
    content = controls_path.read_text('utf-8')
    assert 'section-toggle' in content
    assert 'setSectionDisabled' in content


def test_flat_gradient_type_listed():
    controls_path = Path('static/js/controls.js')
    content = controls_path.read_text('utf-8')
    assert "const GRADIENT_TYPES = ['flat'" in content


def test_renderer_normalizes_flat_gradient():
    renderer_path = Path('static/js/renderer.js')
    content = renderer_path.read_text('utf-8')
    assert "state.gradient?.type === 'none' ? 'flat'" in content
    assert "type === 'flat'" in content


def test_setting_description_styles_present():
    css_path = Path('static/css/app.css')
    content = css_path.read_text('utf-8')
    assert '.setting-description' in content


def test_history_entries_expose_actions():
    presets_path = Path('static/js/presets.js')
    content = presets_path.read_text('utf-8')
    assert 'Reapply' in content
    assert 'Remove' in content


def test_main_avoids_duplicate_hash_renders():
    main_path = Path('static/js/main.js')
    content = main_path.read_text('utf-8')
    assert 'stateFingerprint(state) === stateFingerprint(currentState)' in content


def test_main_coalesces_history_updates():
    main_path = Path('static/js/main.js')
    content = main_path.read_text('utf-8')
    assert 'queueHistoryEntry' in content
    assert 'pendingHistorySnapshot' in content


def test_default_state_includes_effect_toggles():
    state_path = Path('static/js/state.js')
    content = state_path.read_text('utf-8')
    for section in ('rendering', 'gradient', 'grain', 'vignette'):
        pattern = rf"{section}:\s*{{.*?enabled:\s*true"
        assert re.search(pattern, content, flags=re.DOTALL), f"{section} section should default to enabled"


def test_renderer_honors_effect_toggles():
    renderer_path = Path('static/js/renderer.js')
    content = renderer_path.read_text('utf-8')
    assert 'state.rendering?.enabled' in content
    assert 'state.gradient?.enabled' in content
    assert 'state.grain?.enabled' in content
    assert 'vignetteState?.enabled' in content


def test_presets_panel_toggle_preserves_button():
    main_path = Path('static/js/main.js')
    content = main_path.read_text('utf-8')
    assert "panel.classList.toggle('collapsed')" in content
    assert "togglePresets.textContent = collapsed ? 'Show' : 'Hide'" in content
