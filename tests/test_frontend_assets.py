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
