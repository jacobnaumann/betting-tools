import { useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useBetLab } from '../state/BetLabContext';

export function AppLayout({ children }) {
  const { theme, toggleTheme } = useBetLab();
  const location = useLocation();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState(null);

  const isGeneralActive = useMemo(
    () =>
      [
        '/tools/odds-converter',
        '/tools/bet-size',
        '/tools/parlay',
        '/tools/overlay-calculator',
        '/tools/quick-notes',
        '/tools/probability-calculator',
      ].includes(location.pathname),
    [location.pathname]
  );

  const isModellingActive = useMemo(
    () =>
      ['/tools/round-leader-projection', '/tools/basketball-modeling'].includes(
        location.pathname
      ),
    [location.pathname]
  );

  const handleNavLinkClick = () => {
    setIsMobileNavOpen(false);
    setOpenDropdown(null);
  };

  const toggleDropdown = (groupName) => {
    setOpenDropdown((previousGroup) => (previousGroup === groupName ? null : groupName));
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="header-brand">
            <NavLink to="/" className="brand-link" onClick={handleNavLinkClick}>
              <h1>BetLab</h1>
              <p>Personal sports betting tools</p>
            </NavLink>
          </div>
          <button
            type="button"
            className="mobile-menu-toggle"
            aria-controls="betlab-main-nav"
            aria-expanded={isMobileNavOpen}
            onClick={() => setIsMobileNavOpen((previousState) => !previousState)}
          >
            {isMobileNavOpen ? 'Close menu' : 'Menu'}
          </button>
          <nav
            id="betlab-main-nav"
            className={`top-nav ${isMobileNavOpen ? 'is-open' : ''}`}
            aria-label="Primary navigation"
          >
            <div className="top-nav-list">
              <NavLink to="/" end onClick={handleNavLinkClick}>
                Dashboard
              </NavLink>
              <NavLink to="/tools" onClick={handleNavLinkClick}>
                All Tools
              </NavLink>
              <NavLink to="/history" onClick={handleNavLinkClick}>
                History
              </NavLink>
              <div className={`nav-dropdown ${openDropdown === 'general' ? 'is-open' : ''}`}>
                <button
                  type="button"
                  className={`dropdown-toggle ${isGeneralActive ? 'active' : ''}`}
                  onClick={() => toggleDropdown('general')}
                  aria-expanded={openDropdown === 'general'}
                >
                  General
                </button>
                <div className="dropdown-menu">
                  <NavLink to="/tools/odds-converter" onClick={handleNavLinkClick}>
                    Odds Converter
                  </NavLink>
                  <NavLink to="/tools/bet-size" onClick={handleNavLinkClick}>
                    Bet Size Calculator
                  </NavLink>
                  <NavLink to="/tools/parlay" onClick={handleNavLinkClick}>
                    Parlay Builder
                  </NavLink>
                  <NavLink to="/tools/overlay-calculator" onClick={handleNavLinkClick}>
                    Overlay Calculator
                  </NavLink>
                  <NavLink to="/tools/quick-notes" onClick={handleNavLinkClick}>
                    Quick Notes
                  </NavLink>
                  <NavLink to="/tools/probability-calculator" onClick={handleNavLinkClick}>
                    Probability Calculator
                  </NavLink>
                </div>
              </div>
              <div className={`nav-dropdown ${openDropdown === 'modelling' ? 'is-open' : ''}`}>
                <button
                  type="button"
                  className={`dropdown-toggle ${isModellingActive ? 'active' : ''}`}
                  onClick={() => toggleDropdown('modelling')}
                  aria-expanded={openDropdown === 'modelling'}
                >
                  Modelling
                </button>
                <div className="dropdown-menu">
                  <NavLink to="/tools/round-leader-projection" onClick={handleNavLinkClick}>
                    Golf Projection
                  </NavLink>
                  <NavLink to="/tools/basketball-modeling" onClick={handleNavLinkClick}>
                    Basketball Regression
                  </NavLink>
                </div>
              </div>
            </div>
          </nav>
          <button type="button" className="theme-toggle" onClick={toggleTheme}>
            Theme: {theme === 'dark' ? 'Dark' : 'Light'}
          </button>
        </div>
      </header>
      <main className="main-content">{children}</main>
    </div>
  );
}
