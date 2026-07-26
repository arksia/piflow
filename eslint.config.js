import antfu from '@antfu/eslint-config'

export default antfu({
  ignores: [
    '.agents/**',
    '**/*.md',
  ],
  stylistic: true,
  typescript: true,
  vue: true,
}, {
  rules: {
    'antfu/no-top-level-await': 'off',
    'no-console': ['error', { allow: ['info', 'warn', 'error'] }],
    'test/no-import-node-test': 'off',
    'test/prefer-vitest': 'off',
    'ts/no-explicit-any': 'error',
  },
})
