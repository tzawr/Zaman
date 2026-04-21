import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../firebase'
import { 
  collection, 
  addDoc, 
  deleteDoc, 
  doc, 
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from 'firebase/firestore'

function Employees() {
  const navigate = useNavigate()
  const [employees, setEmployees] = useState([])
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState('Barista')
  const [loading, setLoading] = useState(true)

  // 🔥 Load employees from Firebase in real-time
  useEffect(() => {
    const q = query(collection(db, 'employees'), orderBy('createdAt', 'asc'))
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const employeesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }))
      setEmployees(employeesData)
      setLoading(false)
    }, (error) => {
      console.error('Error loading employees:', error)
      setLoading(false)
    })

    // Cleanup listener when component unmounts
    return () => unsubscribe()
  }, [])

  // 🔥 Add employee to Firebase
  const addEmployee = async () => {
    if (newName.trim() === '') return
    
    try {
      await addDoc(collection(db, 'employees'), {
        name: newName.trim(),
        role: newRole,
        createdAt: serverTimestamp()
      })
      setNewName('')
    } catch (error) {
      console.error('Error adding employee:', error)
      alert('Failed to add employee. Try again.')
    }
  }

  // 🔥 Remove employee from Firebase
  const removeEmployee = async (id) => {
    try {
      await deleteDoc(doc(db, 'employees', id))
    } catch (error) {
      console.error('Error removing employee:', error)
      alert('Failed to remove employee. Try again.')
    }
  }

  return (
    <main className="employees-page">
      <div className="page-header">
        <button className="back-button" onClick={() => navigate('/')}>
          ← Back
        </button>
        <h2 className="page-title">Your Team</h2>
        <p className="page-subtitle">
          Add the people you schedule. Use nicknames to keep it private.
        </p>
      </div>

      <div className="add-employee-card">
        <h3 className="card-title">Add Someone</h3>
        <div className="form-row">
          <input
            type="text"
            className="input"
            placeholder="Nickname (e.g. J, Sam, Alex)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addEmployee()}
          />
          <select 
            className="input"
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
          >
            <option>Barista</option>
            <option>Shift Supervisor</option>
            <option>Manager</option>
          </select>
          <button className="add-button" onClick={addEmployee}>
            Add
          </button>
        </div>
      </div>

      <div className="employee-list">
        {loading ? (
          <div className="empty-state">
            <p>Loading your team... ⏳</p>
          </div>
        ) : employees.length === 0 ? (
          <div className="empty-state">
            <p>No one on the team yet. Add your first employee above 👆</p>
          </div>
        ) : (
          employees.map(emp => (
            <div key={emp.id} className="employee-card">
              <div className="employee-info">
                <div className="employee-avatar">{emp.name[0].toUpperCase()}</div>
                <div>
                  <p className="employee-name">{emp.name}</p>
                  <p className="employee-role">{emp.role}</p>
                </div>
              </div>
              <button 
                className="remove-button"
                onClick={() => removeEmployee(emp.id)}
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>

      {!loading && employees.length > 0 && (
        <div className="team-count">
          {employees.length} {employees.length === 1 ? 'person' : 'people'} on your team
        </div>
      )}
    </main>
  )
}

export default Employees