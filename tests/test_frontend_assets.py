from pathlib import Path


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
