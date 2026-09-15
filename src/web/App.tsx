import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Dashboard } from './Dashboard';
import { Library, ProblemDetail } from './Library';
import { ManageLibrary } from './ManageLibrary';
import { lazy, Suspense } from 'react';
import { Loading } from './ui';
const AttemptPage=lazy(()=>import('./Attempt').then(module=>({default:module.AttemptPage})));
import { Topics, TopicDetail } from './Topics';
import { Settings } from './Settings';
export function App() { const focused=useLocation().pathname.startsWith('/attempts/'); if(focused)return <main className="attempt-workspace"><Routes><Route path="/attempts/:id" element={<Suspense fallback={<Loading/>}><AttemptPage/></Suspense>}/></Routes></main>; return <div className="app"><aside className="sidebar"><NavLink to="/" className="brand"><span className="brand-mark" aria-hidden="true">[ ]</span><span>LeetCode<strong>Tutor</strong></span></NavLink><nav aria-label="Main navigation"><NavLink to="/" end>Study desk</NavLink><NavLink to="/library">Question library</NavLink><NavLink to="/topics">Topic progress</NavLink><NavLink to="/settings">Settings & data</NavLink></nav><div className="sidebar-note"><span className="local-dot"/> Local study workspace<p>Your answers, your history.<br/>One question at a time.</p></div></aside><main id="main"><Routes><Route path="/" element={<Dashboard/>}/><Route path="/library" element={<Library/>}/><Route path="/library/manage" element={<ManageLibrary/>}/><Route path="/library/:id" element={<ProblemDetail/>}/><Route path="/topics" element={<Topics/>}/><Route path="/topics/:id" element={<TopicDetail/>}/><Route path="/settings" element={<Settings/>}/><Route path="*" element={<p>Page not found.</p>}/></Routes></main></div>; }
