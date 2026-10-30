final router = GoRouter(routes: [
  GoRoute(path: '/', builder: (c, s) => const Home()),
  GoRoute(path: '/onboarding', builder: (c, s) => const Onboarding()),
  GoRoute(name: 'settings', path: '/settings', builder: (c, s) => const Settings()),
]);
