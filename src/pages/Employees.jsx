import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'
import { 
  collection, 
  addDoc, 
  deleteDoc, 
  doc, 
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp
} from 'firebase/firestore'

function Employees() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const [employees, setEmployees] = useState([])
  const [userRoles, setUserRoles] = useState([])
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState('')
  const [loading, setLoading] = useState(true)
  const [onboardedChecked, setOnboardedChecked] = useState(false)

  // Redirect to sign-in if not logged in
  useEffect(() => {
    if (!currentUser) {
      navigate('/signin')
    }
  }, [currentUser, navigate])

  // Load user's custom roles from their profile
  useEffect(() => {
    if (!currentUser) return

    const userDocRef = doc(db, 'users', currentUser.uid)
    const unsubscribe = onSnapshot(userDocRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data()
        if (!data.onboarded) {
          navigate('/onboarding')
          return
        }
        const rolesList = data.roles || []
        setUserRoles(rolesList)
        // Set default role to first one if no role selected yet
        if (rolesList.length > 0 && !newRole) {
          setNewRole(rolesList[0].name)
        }
        setOnboardedChecked(true)
      } else {
        // No user profile yet — redirect to onboarding
        navigate('/onboarding')
      }
    })

    return () => unsubscribe()
  }, [currentUser, navigate])

  // Load employees for this user
  useEffect(() => {
    if (!currentUser) return

    const q = query(
      collection(db, 'employees'),
      where('userId', '==', currentUser.uid),
      orderBy('createdAt', 'asc')
    )
    
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

    return () => unsubscribe()
  }, [currentUser])

  const addEmployee = async () => {
    if (newName.trim() === '') return
    if (!currentUser) return
    if (!newRole) {
      alert('Please select a role')
      return
    }
    
    try {
      await addDoc(collection(db, 'employees'), {
        userId: currentUser.uid,
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

  const removeEmployee = async (id) => {
    try {
      await deleteDoc(doc(db, 'employees', id))
    } catch (error) {
      console.error('Error removing employee:', error)
      alert('Failed to remove employee. Try again.')
    }
  }

  if (!currentUser || !onboardedChecked) {
    return (
      <main className="employees-page">
        <div className="empty-state">
          <p>Loading... ⏳</p>
        </div>
      </main>
    )
  }

  return (
    <main className="employees-page">
      <div className="page-header">
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
            {userRoles.length === 0 ? (
              <option value="">No roles yet</option>
            ) : (
              userRoles.map(role => (
                <option key={role.id} value={role.name}>
                  {role.name}
                </option>
              ))
            )}
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
            <div 
              key={emp.id} 
              className="employee-card clickable"
              onClick={() => navigate(`/employees/${emp.id}/availability`)}
            >
              <div className="employee-info">
                <div className="employee-avatar">{emp.name[0].toUpperCase()}</div>
                <div>
                  <p className="employee-name">{emp.name}</p>
                  <p className="employee-role">{emp.role}</p>
                </div>
              </div>
              <button 
                className="remove-button"
                onClick={(e) => {
                  e.stopPropagation()
                  removeEmployee(emp.id)
                }}
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