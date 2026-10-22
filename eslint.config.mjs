import nextVitals from 'eslint-config-next/core-web-vitals'

const eslintConfig = [
  ...nextVitals,
  {
    // New in eslint-plugin-react-hooks 7 (Next 16). Existing code predates
    // these checks; warn until it is refactored.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
  { ignores: ['.next/**', 'node_modules/**', 'public/sw.js', 'public/workbox-*.js', 'public/swe-worker-*.js'] },
]

export default eslintConfig
