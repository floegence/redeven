import copy
import importlib.util
import json
import pathlib
import unittest
import sys
sys.dont_write_bytecode = True

DIRECTORY = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('catalog_generator', DIRECTORY / 'generate.py')
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


class SearchDeclarationTests(unittest.TestCase):
    def setUp(self):
        self.data = json.loads((DIRECTORY / 'upstream.json').read_text())
        self.rules = json.loads((DIRECTORY / 'overrides.json').read_text())

    def test_new_model_requires_search_review(self):
        model = copy.deepcopy(self.data['providers']['deepseek']['deepseek-v4-flash'])
        model['id'] = 'future-agent'
        self.data['providers']['deepseek']['future-agent'] = model
        with self.assertRaisesRegex(ValueError, 'missing reviewed web search declaration'):
            generator.generate(self.data, self.rules)

    def test_invalid_search_declarations_fail(self):
        for patch in [{'mode': 'unknown'}, {'mode': 'kimi_builtin'}, {'source_urls': []},
                      {'source_checked_at': 'invalid'}, {'status': 'unknown'}]:
            with self.subTest(patch=patch):
                rules = copy.deepcopy(self.rules)
                group = next(g for g in rules['web_search'] if g['provider'] == 'deepseek')
                group.update(patch)
                with self.assertRaises((ValueError, KeyError)):
                    generator.generate(self.data, rules)

    def test_complete_catalog_and_preserved_snapshot_models(self):
        generated = generator.generate(self.data, self.rules)
        for provider, models in generated['providers'].items():
            for model in models:
                wire = model.get('wire_model_name', model['model_name'])
                self.assertIn(provider + '/' + wire, generated['web_search'])
        self.assertEqual(generated['web_search']['deepseek/deepseek-v4-flash-vision-exp']['mode'], 'deepseek_native')
        self.assertEqual(generated['web_search']['qwen/qwen3.6-plus-2026-04-02']['status'], 'supported')


if __name__ == '__main__':
    unittest.main()
