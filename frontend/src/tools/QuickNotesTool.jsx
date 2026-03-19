import { useState } from 'react';
import { useBetLab } from '../state/BetLabContext';

export function QuickNotesTool() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tag, setTag] = useState('');
  const { notes, addNote, deleteNote } = useBetLab();

  const saveNote = (event) => {
    event.preventDefault();
    if (!title.trim() || !body.trim()) return;
    addNote({
      id: `${Date.now()}-note`,
      title: title.trim(),
      body: body.trim(),
      tag: tag.trim(),
      createdAt: new Date().toLocaleString(),
    });
    setTitle('');
    setBody('');
    setTag('');
  };

  return (
    <section className="stack">
      <header>
        <h2>Quick Notes</h2>
        <p className="page-subtitle">Capture short reads, angles, and reminders for upcoming slates.</p>
      </header>

      <form className="panel stack" onSubmit={saveNote}>
        <label>
          Title
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Cavs vs Magic angle" />
        </label>
        <label>
          Note
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={4}
            placeholder="Magic give up assists to PG..."
          />
        </label>
        <label>
          Tag (optional)
          <input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="NBA, props, totals..." />
        </label>
        <button type="submit" className="primary-button">
          Save Note
        </button>
      </form>

      <div className="panel">
        <h3>Saved Notes</h3>
        {notes.length === 0 ? (
          <p className="muted">No notes yet.</p>
        ) : (
          <ul className="notes-list">
            {notes.map((note) => (
              <li key={note.id}>
                <div className="row-between">
                  <strong>{note.title}</strong>
                  <button type="button" className="ghost-button" onClick={() => deleteNote(note.id)}>
                    Delete
                  </button>
                </div>
                <p>{note.body}</p>
                <span className="muted">
                  {note.tag ? `${note.tag} - ` : ''}
                  {note.createdAt}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
