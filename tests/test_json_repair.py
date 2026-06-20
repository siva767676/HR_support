import pytest

from app import evaluator


def test_parse_json_clean_object():
    assert evaluator._parse_json('{"a": 1, "b": "x"}') == {"a": 1, "b": "x"}


def test_parse_json_strips_code_fence():
    fenced = '```json\n{"a": 1}\n```'
    assert evaluator._parse_json(fenced) == {"a": 1}


def test_parse_json_extracts_object_from_prose():
    prose = 'Here is the result: {"a": 1} — done.'
    assert evaluator._parse_json(prose) == {"a": 1}


def test_parse_json_repairs_truncated_object():
    # Truncated mid-value: repair should drop the dangling field and close braces,
    # keeping the complete leading fields.
    truncated = '{"candidate_name": "Jane", "scores": {"skills_match": 80}, "summary": "incomplete'
    repaired = evaluator._parse_json(truncated)
    assert repaired["candidate_name"] == "Jane"
    assert repaired["scores"]["skills_match"] == 80


def test_parse_json_raises_on_garbage():
    with pytest.raises(ValueError):
        evaluator._parse_json("not json at all")


def test_parse_json_array_clean():
    assert evaluator._parse_json_array('[{"a": 1}, {"a": 2}]') == [{"a": 1}, {"a": 2}]


def test_parse_json_array_from_prose():
    prose = 'Results:\n[{"a": 1}]\nThanks.'
    assert evaluator._parse_json_array(prose) == [{"a": 1}]


def test_parse_json_array_raises_on_object():
    # A bare object is not a valid array response.
    with pytest.raises(ValueError):
        evaluator._parse_json_array('{"a": 1}')


def test_comma_positions_ignores_strings():
    # Commas inside string literals must not be counted as top-level separators.
    s = '{"a": "x,y", "b": 2}'
    positions = evaluator._comma_positions(s)
    # Only the comma between fields (outside the string) should be found.
    assert len(positions) == 1
    assert s[positions[0]] == ","


def test_closer_for_balances_open_structures():
    # Open object + open array -> needs "]}" to balance.
    assert evaluator._closer_for('{"a": [1, 2') == "]}"
    # Open string mid-value -> needs to close the quote then the brace.
    assert evaluator._closer_for('{"a": "unterminated') == '"}'
