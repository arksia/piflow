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
    'ts/no-explicit-any': 'error',
  },
})
