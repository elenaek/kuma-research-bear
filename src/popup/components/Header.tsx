/**
 * Header component for the popup
 * Displays the Kuma logo and title
 */
export function Header() {
  return (
    <header class="mb-6 text-center">
      {/* Logo */}
      <div class="flex justify-center mb-4">
        <img
          src="/icons/icon128.png"
          alt="Kuma the Research Bear"
          class="w-28 h-28"
        />
      </div>

      <h1 class="text-2xl font-bold text-gray-800">Kuma the Research Bear</h1>
      <p class="text-sm text-gray-600 pt-2 font-light">
        AI-Powered Bear that helps you understand research papers
      </p>
    </header>
  );
}
