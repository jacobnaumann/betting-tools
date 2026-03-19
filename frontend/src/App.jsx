import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { DashboardPage } from './pages/DashboardPage';
import { ToolsPage } from './pages/ToolsPage';
import { HistoryPage } from './pages/HistoryPage';
import { OddsConverterTool } from './tools/OddsConverterTool';
import { BetSizeTool } from './tools/BetSizeTool';
import { ParlayTool } from './tools/ParlayTool';
import { QuickNotesTool } from './tools/QuickNotesTool';
import { OverlayCalculatorTool } from './tools/OverlayCalculatorTool';
import { RoundLeaderProjectionTool } from './tools/RoundLeaderProjectionTool';
import { ProbabilityCalculatorTool } from './tools/ProbabilityCalculatorTool';
import { NotFoundPage } from './pages/NotFoundPage';

function App() {
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/tools" element={<ToolsPage />} />
        <Route path="/tools/odds-converter" element={<OddsConverterTool />} />
        <Route path="/tools/bet-size" element={<BetSizeTool />} />
        <Route path="/tools/parlay" element={<ParlayTool />} />
        <Route path="/tools/quick-notes" element={<QuickNotesTool />} />
        <Route path="/tools/overlay-calculator" element={<OverlayCalculatorTool />} />
        <Route path="/tools/round-leader-projection" element={<RoundLeaderProjectionTool />} />
        <Route path="/tools/probability-calculator" element={<ProbabilityCalculatorTool />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/404" element={<NotFoundPage />} />
        <Route path="*" element={<Navigate to="/404" replace />} />
      </Routes>
    </AppLayout>
  );
}

export default App;
