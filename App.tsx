import React from 'react';
import { Repl } from './components/Repl';

const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-black">
      <Repl />
    </div>
  );
};

export default App;