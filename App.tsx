import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Sparkles, BrainCircuit, Layout, List, Bell, ArrowUpDown, Calendar, AlertTriangle, Terminal, Activity, Clock, ChevronRight, BarChart3, Layers, LogOut, Database, User as UserIcon } from 'lucide-react';
import { Task, TaskStatus, Priority, AIAnalysisResult } from './types';
import TaskCard from './components/TaskCard';
import TaskFormModal from './components/TaskFormModal';
import LoginPage from './components/LoginPage';
import { parseTaskWithAI, analyzeScheduleWithAI } from './services/geminiService';
import { auth, db } from './firebase';
import firebase from 'firebase/compat/app';

type MobileTab = 'TASKS' | 'SYSTEM';

const App: React.FC = () => {
  const [user, setUser] = useState<firebase.User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [aiInput, setAiInput] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [analysis, setAnalysis] = useState<AIAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'ALL' | TaskStatus>('ALL');
  const [sortBy, setSortBy] = useState<'DATE' | 'PRIORITY'>('DATE');
  const [mobileTab, setMobileTab] = useState<MobileTab>('TASKS');

  // Authentication Listener
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((currUser) => {
      setUser(currUser);
      setAuthLoading(false);
    });
    return unsubscribe;
  }, []);

  // Firestore Real-time Listener
  useEffect(() => {
    if (!user) {
      setTasks([]);
      return;
    }

    const unsubscribe = db.collection('users').doc(user.uid).collection('tasks')
      .onSnapshot((snapshot) => {
        const loadedTasks = snapshot.docs.map(doc => doc.data() as Task);
        setTasks(loadedTasks);
      }, (error) => {
        console.error("Firestore sync error:", error);
      });

    return unsubscribe;
  }, [user]);

  // Request notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }
  }, []);

  const playNotificationSound = useCallback(() => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.type = 'square';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
      
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
      
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) {
      console.error("Audio play failed", e);
    }
  }, []);

  // Alert Polling Logic
  useEffect(() => {
    if (tasks.length === 0 || !user) return;

    const intervalId = setInterval(() => {
      const now = new Date().getTime();
      
      tasks.forEach(task => {
        // Skip if done or already alerted
        if (task.status === TaskStatus.DONE || task.alerted) return;

        const dueTime = new Date(task.dueDate).getTime();
        
        // Trigger alert if deadline passed
        if (dueTime <= now) {
          playNotificationSound();

          const title = `SYSTEM ALERT: ${task.title}`;
          const options = {
            body: "DEADLINE REACHED. PROTOCOL OVERDUE.",
            icon: '/favicon.ico',
            tag: `task-${task.id}`,
          };

          if ('Notification' in window && Notification.permission === 'granted') {
            try {
              new Notification(title, options);
            } catch (e) { console.log(e); }
          }
          
          // Update alerted state in Firestore WITHOUT marking as done
          db.collection('users').doc(user.uid).collection('tasks').doc(task.id).update({
            alerted: true
          });
        }
      });

    }, 5000); 

    return () => clearInterval(intervalId);
  }, [tasks, playNotificationSound, user]);

  // CRUD Operations (Firestore)
  const addTask = async (taskData: Partial<Task>) => {
    if (!user) return;
    const newTask: Task = {
      id: crypto.randomUUID(),
      title: taskData.title || 'Untitled Protocol',
      description: taskData.description || '',
      dueDate: taskData.dueDate || new Date().toISOString(),
      priority: taskData.priority || Priority.MEDIUM,
      status: TaskStatus.TODO,
      createdAt: new Date().toISOString(),
      aiSuggested: !!taskData.aiSuggested,
      alerted: false,
      subtasks: taskData.subtasks || []
    };
    
    try {
      await db.collection('users').doc(user.uid).collection('tasks').doc(newTask.id).set(newTask);
      setMobileTab('TASKS');
    } catch (error) {
      console.error("Error adding task:", error);
      alert("FAILED TO WRITE TO CLOUD.");
    }
  };

  const updateTask = async (taskData: Partial<Task>) => {
    if (!editingTask || !user) return;
    try {
      await db.collection('users').doc(user.uid).collection('tasks').doc(editingTask.id).update(taskData);
      setEditingTask(null);
    } catch (error) {
      console.error("Error updating task:", error);
    }
  };

  const deleteTask = async (id: string) => {
    if (!user) return;
    try {
      await db.collection('users').doc(user.uid).collection('tasks').doc(id).delete();
    } catch (error) {
      console.error("Error deleting task:", error);
    }
  };

  const toggleStatus = async (id: string, status: TaskStatus) => {
    if (!user) return;
    try {
      await db.collection('users').doc(user.uid).collection('tasks').doc(id).update({ status });
    } catch (error) {
      console.error("Error toggling status:", error);
    }
  };

  const toggleSubtask = async (taskId: string, subtaskId: string) => {
    if (!user) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task || !task.subtasks) return;

    const updatedSubtasks = task.subtasks.map(st => 
      st.id === subtaskId ? { ...st, isCompleted: !st.isCompleted } : st
    );

    try {
      await db.collection('users').doc(user.uid).collection('tasks').doc(taskId).update({ subtasks: updatedSubtasks });
    } catch (error) {
      console.error("Error toggling subtask:", error);
    }
  };

  const handleAiSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiInput.trim()) return;

    setIsAiLoading(true);
    try {
      const parsedTask = await parseTaskWithAI(aiInput);
      await addTask(parsedTask);
      setAiInput('');
    } catch (error) {
      alert("AI PARSING ERROR.");
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    try {
      const result = await analyzeScheduleWithAI(tasks);
      setAnalysis(result);
    } catch (error) {
      console.error(error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleLogout = async () => {
    try {
      await auth.signOut();
      setTasks([]);
      setAnalysis(null);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const upcomingTasksCount = tasks.filter(t => {
    if (t.status === TaskStatus.DONE) return false;
    const diff = new Date(t.dueDate).getTime() - new Date().getTime();
    return diff > 0 && diff < 24 * 60 * 60 * 1000;
  }).length;

  const filteredTasks = tasks
    .filter(t => filterStatus === 'ALL' || t.status === filterStatus)
    .sort((a, b) => {
      if (sortBy === 'PRIORITY') {
        const priorityWeight = { [Priority.URGENT]: 3, [Priority.HIGH]: 2, [Priority.MEDIUM]: 1, [Priority.LOW]: 0 };
        const diff = priorityWeight[b.priority] - priorityWeight[a.priority];
        if (diff !== 0) return diff;
      }
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });

  // Render Logic
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center gap-4 text-zinc-500 font-mono">
         <div className="w-8 h-8 border border-zinc-700 border-t-white animate-spin"></div>
         <div className="text-xs tracking-widest animate-pulse">ESTABLISHING UPLINK...</div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-300 selection:bg-white selection:text-black flex flex-col font-sans pb-16 md:pb-0">
      
      {/* Top Protocol Bar */}
      <header className="border-b border-zinc-800 bg-[#050505] sticky top-0 z-40 shadow-2xl shadow-black/50">
        <div className="flex flex-col md:flex-row md:items-stretch">
          <div className="flex items-center justify-between p-3 md:p-4 md:w-64 md:border-r border-zinc-800 shrink-0">
            <h1 className="text-lg md:text-xl font-bold tracking-tighter text-white font-mono flex items-center gap-2">
              <span className="w-2 h-2 md:w-3 md:h-3 bg-white block"></span>
              ZENITH.SYS
            </h1>
            
            <div className="md:hidden flex items-center gap-3">
               {upcomingTasksCount > 0 && (
                  <div className="flex items-center gap-1 text-orange-500 animate-pulse">
                     <AlertTriangle size={14} />
                     <span className="text-xs font-mono font-bold">{upcomingTasksCount}</span>
                  </div>
               )}
            </div>
          </div>
          
          <div className="hidden md:flex flex-1 items-center overflow-hidden border-t md:border-t-0 border-zinc-800 bg-zinc-900/20 justify-between">
            <div className="flex-1 px-4 py-2 font-mono text-xs text-zinc-500 truncate flex items-center gap-6">
               <span className="flex items-center gap-2 text-emerald-500/80">
                 <Database size={12} />
                 STORAGE: CLOUD_SYNC
               </span>
               <span className="flex items-center gap-2">
                 <UserIcon size={12} />
                 USR: {user.email?.split('@')[0].toUpperCase()}
               </span>
               {upcomingTasksCount > 0 && <span className="text-orange-500 animate-pulse">ALERT: {upcomingTasksCount} CRITICAL TASKS PENDING</span>}
            </div>
            <div className="border-l border-zinc-800 h-full flex items-center">
               <button 
                onClick={handleLogout}
                className="h-full px-6 hover:bg-zinc-800 hover:text-white transition-colors font-mono text-xs uppercase tracking-widest font-bold flex items-center gap-2 border-r border-zinc-800"
              >
                <LogOut size={14} />
                DISCONNECT
              </button>
              <button 
                onClick={() => { setEditingTask(null); setIsModalOpen(true); }}
                className="h-full px-6 hover:bg-white hover:text-black transition-colors font-mono text-xs uppercase tracking-widest font-bold flex items-center gap-2"
              >
                <Plus size={14} /> New Entry
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col md:flex-row h-[calc(100vh-60px)] md:h-auto overflow-hidden md:overflow-visible">
        
        {/* Main Content Area (Mobile Tab: TASKS) */}
        <main className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${mobileTab === 'TASKS' ? 'translate-x-0' : '-translate-x-full md:translate-x-0 hidden md:flex'}`}>
          
          {/* AI Command Input */}
          <section className="border-b border-zinc-800 bg-[#050505] relative group shrink-0">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600">
              <Terminal size={16} />
            </div>
            <input
              type="text"
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              placeholder="ENTER PROTOCOL..."
              className="w-full bg-transparent text-white p-4 pl-10 md:p-6 md:pl-12 text-base md:text-2xl font-light focus:outline-none placeholder-zinc-700 font-mono"
              onKeyDown={(e) => e.key === 'Enter' && handleAiSubmit(e)}
              disabled={isAiLoading}
            />
            {isAiLoading && (
              <div className="absolute right-6 top-1/2 -translate-y-1/2">
                 <div className="w-2 h-2 bg-white animate-ping"></div>
              </div>
            )}
            <div className="absolute bottom-0 left-0 w-full h-[1px] bg-zinc-800 group-focus-within:bg-white transition-colors duration-500"></div>
          </section>

          {/* Controls Bar */}
          <div className="flex border-b border-zinc-800 overflow-x-auto no-scrollbar bg-[#050505] shrink-0">
            <div className="flex p-2 gap-2 shrink-0">
               {(['ALL', TaskStatus.TODO, TaskStatus.DONE] as const).map(status => (
                 <button
                   key={status}
                   onClick={() => setFilterStatus(status)}
                   className={`px-3 py-1.5 md:px-4 md:py-1.5 text-[10px] md:text-xs font-mono uppercase tracking-wider border transition-all
                     ${filterStatus === status 
                       ? 'bg-zinc-800 text-white border-zinc-600' 
                       : 'text-zinc-500 border-transparent hover:border-zinc-800 hover:text-zinc-300'
                     }`}
                 >
                   [{status === 'ALL' ? 'ALL' : status}]
                 </button>
               ))}
            </div>
            <div className="ml-auto flex items-center border-l border-zinc-800 px-4 gap-4 shrink-0">
               <button onClick={() => setSortBy('DATE')} className={`text-[10px] md:text-xs font-mono whitespace-nowrap hover:text-white ${sortBy === 'DATE' ? 'text-white underline decoration-zinc-500 underline-offset-4' : 'text-zinc-500'}`}>SORT: TIME</button>
               <button onClick={() => setSortBy('PRIORITY')} className={`text-[10px] md:text-xs font-mono whitespace-nowrap hover:text-white ${sortBy === 'PRIORITY' ? 'text-white underline decoration-zinc-500 underline-offset-4' : 'text-zinc-500'}`}>SORT: LVL</button>
            </div>
          </div>

          {/* Task Grid */}
          <div className="flex-1 bg-zinc-900/10 overflow-y-auto pb-20 md:pb-0">
            {filteredTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-zinc-600 gap-4">
                <Activity size={32} strokeWidth={1} />
                <p className="font-mono text-xs tracking-widest">NO ACTIVE PROTOCOLS</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 auto-rows-min">
                {filteredTasks.map(task => (
                  <TaskCard 
                    key={task.id} 
                    task={task} 
                    onStatusChange={toggleStatus}
                    onSubtaskToggle={toggleSubtask}
                    onDelete={deleteTask}
                    onEdit={(t) => {
                      setEditingTask(t);
                      setIsModalOpen(true);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </main>

        {/* Sidebar Diagnostics (Mobile Tab: SYSTEM) */}
        <aside className={`w-full md:w-80 border-l border-zinc-800 bg-[#080808] flex flex-col md:h-auto overflow-y-auto transition-all duration-300 
          ${mobileTab === 'SYSTEM' ? 'translate-x-0 h-[calc(100vh-120px)]' : 'translate-x-full hidden md:flex md:translate-x-0'}
        `}>
           <div className="p-4 border-b border-zinc-800 shrink-0">
              <div className="flex items-center justify-between mb-4">
                 <h2 className="text-sm font-bold font-mono text-white flex items-center gap-2">
                    <BrainCircuit size={14} />
                    DIAGNOSTICS
                 </h2>
                 <button 
                  onClick={handleAnalyze}
                  disabled={isAnalyzing || tasks.length === 0}
                  className="text-[10px] bg-white text-black px-3 py-1 font-mono hover:bg-zinc-200 disabled:opacity-50"
                 >
                   {isAnalyzing ? 'COMPUTING...' : 'RUN ANALYSIS'}
                 </button>
              </div>
              
              {analysis ? (
                 <div className="space-y-4">
                    <div className="border border-zinc-800 p-3 bg-zinc-900/30">
                       <span className="text-[10px] text-zinc-500 font-mono block mb-1">SYSTEM LOAD</span>
                       <span className={`text-lg font-bold uppercase ${analysis.mood === 'overloaded' ? 'text-red-500' : 'text-white'}`}>
                          {analysis.mood}
                       </span>
                    </div>
                    <p className="text-xs text-zinc-400 leading-relaxed font-mono border-l-2 border-zinc-700 pl-3">
                       {analysis.summary}
                    </p>
                    <div className="space-y-2">
                       {analysis.suggestions.map((s, i) => (
                          <div key={i} className="flex gap-2 text-xs text-zinc-500">
                             <span className="text-zinc-700">::</span>
                             {s}
                          </div>
                       ))}
                    </div>
                 </div>
              ) : (
                 <div className="h-32 border border-zinc-800 border-dashed flex items-center justify-center text-[10px] text-zinc-700 font-mono">
                    AWAITING INPUT DATA
                 </div>
              )}
           </div>

           <div className="p-4 flex-1">
              <h3 className="text-[10px] font-mono text-zinc-600 mb-4 tracking-widest">METRICS</h3>
              <div className="grid grid-cols-2 gap-px bg-zinc-800 border border-zinc-800">
                 <div className="bg-[#080808] p-4">
                    <div className="text-2xl font-light text-white">{tasks.filter(t => t.status === TaskStatus.DONE).length}</div>
                    <div className="text-[10px] text-zinc-500 font-mono mt-1">ARCHIVED</div>
                 </div>
                 <div className="bg-[#080808] p-4">
                    <div className="text-2xl font-light text-white">{tasks.filter(t => t.status === TaskStatus.TODO).length}</div>
                    <div className="text-[10px] text-zinc-500 font-mono mt-1">PENDING</div>
                 </div>
                 <div className="bg-[#080808] p-4">
                    <div className="text-2xl font-light text-red-500">
                      {tasks.filter(t => t.priority === Priority.URGENT && t.status !== TaskStatus.DONE).length}
                    </div>
                    <div className="text-[10px] text-zinc-500 font-mono mt-1">CRITICAL</div>
                 </div>
                 <div className="bg-[#080808] p-4">
                    <div className="text-2xl font-light text-zinc-400">
                      {tasks.filter(t => t.aiSuggested).length}
                    </div>
                    <div className="text-[10px] text-zinc-500 font-mono mt-1">AUTO-GEN</div>
                 </div>
              </div>
           </div>
           
           <div className="p-4 border-t border-zinc-800 shrink-0">
              <div className="text-[10px] text-zinc-700 font-mono">
                 ZENITH.SYS v2.4.1<br/>
                 MEMORY USAGE: OPTIMAL
              </div>
           </div>
        </aside>

      </div>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-[#050505] border-t border-zinc-800 flex justify-between px-2 z-50 pb-safe">
         <button 
            onClick={() => setMobileTab('TASKS')}
            className={`flex-1 p-3 flex flex-col items-center gap-1 transition-colors ${mobileTab === 'TASKS' ? 'text-white' : 'text-zinc-600'}`}
         >
            <Layers size={18} />
            <span className="text-[10px] font-mono tracking-widest">TASKS</span>
         </button>
         <div className="w-[1px] bg-zinc-800 my-2"></div>
         <div className="flex-1 flex items-center justify-center">
             <button onClick={() => { setEditingTask(null); setIsModalOpen(true); }} className="bg-white text-black p-3 rounded-none">
                <Plus size={20} />
             </button>
         </div>
         <div className="w-[1px] bg-zinc-800 my-2"></div>
         <button 
            onClick={() => setMobileTab('SYSTEM')}
            className={`flex-1 p-3 flex flex-col items-center gap-1 transition-colors ${mobileTab === 'SYSTEM' ? 'text-white' : 'text-zinc-600'}`}
         >
            <BarChart3 size={18} />
            <span className="text-[10px] font-mono tracking-widest">SYSTEM</span>
         </button>
      </nav>

      <TaskFormModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onSubmit={editingTask ? updateTask : addTask}
        editingTask={editingTask}
      />
    </div>
  );
};

export default App;
