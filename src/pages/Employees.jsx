import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

function Employees() {
  const navigate = useNavigate()
  const [employees, setEmployees] = useState([])
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState('Barista')

  const addEmployee = () => {
    if (newName.trim() === '') return
    
    const newEmployee = {
      id: Date.now(),
      name: newName,
      role: newRole
    }
    
    setEmployees([...employees, newEmployee])
    setNewName('')
  }

  const removeEmployee = (id) => {
    setEmployees(employees.filter(emp => emp.id !== id))
  }

  return (
    <main className="employees-page">
      <div className="page-header">
        <button className="back-button" onClick={() => navigate('/')}>
          ← Back
        </button>
        <h2 className="page-title">Your Team</h2>
        <p className="page-subtitle">
            Add your team. Use nicknames to keep things private. 🔒        </p>
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
        {employees.length === 0 ? (
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

      {employees.length > 0 && (
        <div className="team-count">
          {employees.length} {employees.length === 1 ? 'person' : 'people'} on your team
        </div>
      )}
    </main>
  )
}

export default Employees