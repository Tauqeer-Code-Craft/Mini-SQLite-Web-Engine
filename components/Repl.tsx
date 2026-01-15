import React, { useState, useEffect, useRef } from 'react';
import { Database } from '../lib/database';
import { runTests } from '../lib/tests';

const WELCOME_MSG = `
Mini-SQLite Web Engine v2.6 (Join + Tx + Tests)
===============================================
Supported Commands:
  CREATE TABLE name (id INTEGER PRIMARY KEY, name TEXT)
  INSERT INTO name VALUES (1, 'Alice')
  SELECT * FROM name JOIN other ON name.id = other.ref_id
  UPDATE name SET name='Bob' WHERE id=1
  DELETE FROM name WHERE id=1
  
  Transactions: BEGIN, COMMIT, ROLLBACK
  System: 'CLEAR', 'RESET', 'TEST'
`;

const db = new Database();

export const Repl: React.FC = () => {
  const [history, setHistory] = useState<Array<{ type: 'input' | 'output' | 'error', content: any }>>([
    { type: 'output', content: WELCOME_MSG }
  ]);
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [history]);

  const executeCommand = () => {
    if (!input.trim()) return;

    const cmd = input.trim();
    setHistory(prev => [...prev, { type: 'input', content: cmd }]);
    setInput('');

    const upper = cmd.toUpperCase();

    if (upper === 'CLEAR') {
        setHistory([]);
        return;
    }
    if (upper === 'RESET') {
        db.hardReset();
        setHistory(prev => [...prev, { type: 'output', content: "Database wiped."}]);
        return;
    }
    if (upper === 'TEST') {
        const logs = runTests();
        // Sync main DB instance with changes made by the test runner
        db.refresh();
        setHistory(prev => [...prev, { type: 'output', content: logs.join('\n') }]);
        return;
    }

    try {
      const result = db.execute(cmd);
      setHistory(prev => [...prev, { type: 'output', content: result }]);
    } catch (e: any) {
      setHistory(prev => [...prev, { type: 'error', content: e.message }]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      executeCommand();
    }
  };

  const renderContent = (item: any) => {
      if (Array.isArray(item.content)) {
          if (item.content.length === 0) return "Empty set";
          const cols = Object.keys(item.content[0]);
          return (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm whitespace-nowrap">
                    <thead>
                        <tr className="border-b border-gray-600">
                            {cols.map(c => <th key={c} className="p-2 text-green-400 font-bold">{c}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {item.content.map((row: any, i: number) => (
                            <tr key={i} className="border-b border-gray-800 hover:bg-gray-800">
                                {cols.map(c => <td key={c} className="p-2 text-gray-300">{row[c]}</td>)}
                            </tr>
                        ))}
                    </tbody>
                </table>
              </div>
          );
      }
      return <pre className="whitespace-pre-wrap">{String(item.content)}</pre>;
  };

  return (
    <div className="flex flex-col h-screen bg-[#1e1e1e] text-[#d4d4d4] p-4 font-mono">
      <div className="flex-1 overflow-y-auto mb-4 space-y-2">
        {history.map((item, idx) => (
          <div key={idx} className={`${item.type === 'input' ? 'text-yellow-300 font-bold mt-4' : ''} ${item.type === 'error' ? 'text-red-400' : ''}`}>
             {item.type === 'input' && <span className="mr-2">&gt;</span>}
             {renderContent(item)}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="flex items-center bg-[#2d2d2d] p-2 rounded border border-gray-600">
        <span className="text-green-500 mr-2 font-bold">$</span>
        <input
          type="text"
          className="flex-1 bg-transparent outline-none text-white placeholder-gray-500"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter SQL command or 'TEST'..."
          autoFocus
        />
      </div>
    </div>
  );
};