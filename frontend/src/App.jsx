
import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import './App.css'

const SERVER_URL = 'http://localhost:3001'

function formatTime(seconds = 0) {
  const safeSeconds = Math.max(0, Number(seconds) || 0)
  const minutes = Math.floor(safeSeconds / 60)
  const remaining = safeSeconds % 60

  return `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
}

function App() {
  // ==========================================
  // 1. CONEXION CON EL BACKEND
  // ==========================================

  const socketRef = useRef(null)

  const [connectionStatus, setConnectionStatus] = useState('Conectando...')

  // ==========================================
  // 2. NAVEGACION Y DATOS
  // ==========================================

  const [screen, setScreen] = useState('home')

  const [hostName, setHostName] = useState('')
  const [maxTeams, setMaxTeams] = useState('5')

  const [teamName, setTeamName] = useState('')
  const [accessCode, setAccessCode] = useState('')

  // ==========================================
  // 3. ESTADO DE LA PARTIDA
  // ==========================================

  const [activeRoom, setActiveRoom] = useState(null)
  const [roomRole, setRoomRole] = useState('')
  const [registeredTeam, setRegisteredTeam] = useState(null)

  const [hostToken, setHostToken] = useState('')

  const [loading, setLoading] = useState(false)
  const [selectedCard, setSelectedCard] = useState('')
  const [message, setMessage] = useState('')

  // ==========================================
  // 4. ESTADO DEL PODER DE ROBO
  // ==========================================

  const [stealTarget, setStealTarget] = useState('')
  const [stealAmount, setStealAmount] = useState('2')
  const [usingPower, setUsingPower] = useState(false)

  // ==========================================
  // 5. CONEXION SOCKET.IO
  // ==========================================

  useEffect(() => {
    const socket = io(SERVER_URL)

    socketRef.current = socket

    socket.on('connect', () => {
      console.log('Conectado al backend:', socket.id)
      setConnectionStatus('Conectado')
    })

    socket.on('connect_error', (error) => {
      console.error('Error de conexión:', error.message)
      setConnectionStatus('Sin conexión')
    })

    socket.on('disconnect', () => {
      console.log('Desconectado del backend')
      setConnectionStatus('Desconectado')
    })

    socket.on('room-updated', (room) => {
      console.log('Actualización de sala:', room)

      setActiveRoom(room)
      setSelectedCard('')

      if (room.status === 'playing') {
        setScreen('playing')
      }

      if (room.status === 'finished') {
        setScreen('finished')
      }
    })

    socket.on('game-started', (room) => {
      console.log('Partida iniciada:', room)

      if (room) {
        setActiveRoom(room)
      }

      setSelectedCard('')
      setScreen('playing')
      setMessage('¡La partida ha comenzado!')
    })

    socket.on('game-finished', (data) => {
      console.log('Partida finalizada:', data)

      if (data.room) {
        setActiveRoom(data.room)
      }

      setScreen('finished')
      setMessage('¡La partida ha terminado!')
    })

    socket.on('room-error', (data) => {
      setMessage(data.message || 'Ocurrió un error en la sala.')
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [])

  // ==========================================
  // 6. NAVEGACION
  // ==========================================

  const goHome = () => {
    setScreen('home')
    setActiveRoom(null)
    setRegisteredTeam(null)
    setRoomRole('')
    setHostToken('')
    setSelectedCard('')
    setStealTarget('')
    setStealAmount('2')
    setMessage('')
  }

  const openCreateRoom = () => {
    setScreen('create')
    setMessage('')
    setActiveRoom(null)
    setRegisteredTeam(null)
    setHostToken('')
    setRoomRole('')
  }

  const openJoinRoom = () => {
    setScreen('join')
    setMessage('')
  }

  // ==========================================
  // 7. SUSCRIBIRSE A UNA SALA
  // ==========================================

  const subscribeToRoom = (code) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('join-room', { code })
    } else {
      setMessage('El servidor no está conectado. Intenta nuevamente.')
    }
  }

  // ==========================================
  // 8. CREAR PARTIDA
  // ==========================================

  const handleCreateRoom = async (event) => {
    event.preventDefault()
    setMessage('')

    if (!hostName.trim()) {
      setMessage('Escribe el nombre del instructor.')
      return
    }

    if (connectionStatus !== 'Conectado') {
      setMessage('No hay conexión con el servidor.')
      return
    }

    setLoading(true)

    try {
      const response = await fetch(`${SERVER_URL}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          hostName: hostName.trim(),
          maxTeams: Number(maxTeams)
        })
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'No se pudo crear la partida.')
      }

      if (!data.hostToken) {
        throw new Error('El backend no devolvió el token del instructor.')
      }

      setActiveRoom(data.room)
      setHostToken(data.hostToken)
      setRoomRole('host')
      setRegisteredTeam(null)
      setScreen('waiting')

      subscribeToRoom(data.room.code)

      setMessage('Partida creada correctamente.')
    } catch (error) {
      console.error('Error al crear partida:', error)
      setMessage(error.message)
    } finally {
      setLoading(false)
    }
  }

  // ==========================================
  // 9. REGISTRAR EQUIPO
  // ==========================================

  const handleJoinRoom = async (event) => {
    event.preventDefault()
    setMessage('')

    if (!teamName.trim()) {
      setMessage('Escribe el nombre de tu equipo.')
      return
    }

    const normalizedCode = accessCode.trim().toUpperCase()

    if (!/^[A-Z0-9]{5}$/.test(normalizedCode)) {
      setMessage('El código debe tener exactamente 5 caracteres.')
      return
    }

    if (connectionStatus !== 'Conectado') {
      setMessage('No hay conexión con el servidor.')
      return
    }

    setLoading(true)

    try {
      const response = await fetch(
        `${SERVER_URL}/api/rooms/${normalizedCode}/teams`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            teamName: teamName.trim()
          })
        }
      )

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'No se pudo registrar el equipo.')
      }

      setActiveRoom(data.room)
      setRegisteredTeam(data.team)
      setRoomRole('team')
      setScreen('waiting')

      subscribeToRoom(normalizedCode)

      setMessage('¡Equipo registrado correctamente!')
    } catch (error) {
      console.error('Error al ingresar:', error)
      setMessage(error.message)
    } finally {
      setLoading(false)
    }
  }

  // ==========================================
  // 10. INICIAR PARTIDA
  // ==========================================

  const handleStartGame = async () => {
    setMessage('')

    if (roomRole !== 'host') {
      setMessage('Solo el instructor puede iniciar la partida.')
      return
    }

    if (!activeRoom?.code || !hostToken) {
      setMessage('Faltan los datos de autorización del instructor.')
      return
    }

    if (activeRoom.teams.length < 2) {
      setMessage('Se necesitan al menos 2 equipos para comenzar.')
      return
    }

    setLoading(true)

    try {
      const response = await fetch(
        `${SERVER_URL}/api/rooms/${activeRoom.code}/start`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-host-token': hostToken
          }
        }
      )

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'No se pudo iniciar la partida.')
      }

      setActiveRoom(data.room)
      setScreen('playing')
      setMessage('¡La partida ha comenzado!')
    } catch (error) {
      console.error('Error al iniciar partida:', error)
      setMessage(error.message)
    } finally {
      setLoading(false)
    }
  }

  // ==========================================
  // 11. COPIAR CODIGO
  // ==========================================

  const copyRoomCode = async () => {
    if (!activeRoom?.code) return

    try {
      await navigator.clipboard.writeText(activeRoom.code)
      setMessage('Código copiado correctamente.')
    } catch (error) {
      console.error('Error al copiar:', error)
      setMessage('No se pudo copiar. Selecciona el código manualmente.')
    }
  }

  // ==========================================
  // 12. SELECCIONAR CARTA
  // ==========================================

  const handleFlipCard = async (card) => {
    setMessage('')

    if (!activeRoom || !registeredTeam || roomRole !== 'team') {
      setMessage('Debes ingresar como equipo para seleccionar cartas.')
      return
    }

    if (activeRoom.status !== 'playing') {
      setMessage('La partida todavía no está activa.')
      return
    }

    if (activeRoom.currentTeamId !== registeredTeam.id) {
      setMessage('No es el turno de tu equipo.')
      return
    }

    if (activeRoom.isResolving) {
      setMessage('Espera a que se resuelva la jugada anterior.')
      return
    }

    if (card.matched || card.revealed) {
      return
    }

    setSelectedCard(card.id)

    try {
      const response = await fetch(
        `${SERVER_URL}/api/rooms/${activeRoom.code}/flip`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            teamId: registeredTeam.id,
            cardId: card.id
          })
        }
      )

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'No se pudo seleccionar la carta.')
      }

      setMessage(data.message || 'Carta seleccionada.')

      if (data.room) {
        setActiveRoom(data.room)
      }
    } catch (error) {
      console.error('Error al seleccionar carta:', error)
      setMessage(error.message)
    } finally {
      setSelectedCard('')
    }
  }

  // ==========================================
  // 13. PODER ESPECIAL: ROBAR PUNTOS
  // ==========================================

  const handleStealPoints = async (event) => {
    event.preventDefault()
    setMessage('')

    if (roomRole !== 'team' || !registeredTeam) {
      setMessage('Solo los equipos pueden utilizar este poder.')
      return
    }

    if (!activeRoom || activeRoom.status !== 'playing') {
      setMessage('La partida no está activa.')
      return
    }

    if (!isMyTurn) {
      setMessage('Solo puedes utilizar el poder durante tu turno.')
      return
    }

    const myTeam = activeRoom.teams.find(
      team => team.id === registeredTeam.id
    )

    if (!myTeam?.powers?.steal) {
      setMessage('Tu equipo ya utilizó el poder de robo.')
      return
    }

    if (!stealTarget) {
      setMessage('Selecciona el equipo al que deseas robar.')
      return
    }

    if (activeRoom.isResolving) {
      setMessage('Espera a que termine la jugada actual.')
      return
    }

    setUsingPower(true)

    try {
      const response = await fetch(
        `${SERVER_URL}/api/rooms/${activeRoom.code}/powers/steal`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            teamId: registeredTeam.id,
            targetId: stealTarget,
            amount: Number(stealAmount)
          })
        }
      )

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'No se pudo utilizar el poder de robo.')
      }

      if (data.room) {
        setActiveRoom(data.room)
      }

      setMessage(data.message)

      setStealTarget('')
      setStealAmount('2')

      console.log('Resultado del poder de robo:', data)
    } catch (error) {
      console.error('Error al robar puntos:', error)
      setMessage(error.message)
    } finally {
      setUsingPower(false)
    }
  }

  // ==========================================
  // 14. DATOS DERIVADOS DEL JUEGO
  // ==========================================

  const currentTeam = activeRoom?.teams?.find(
    team => team.id === activeRoom.currentTeamId
  )

  const myTeam = activeRoom?.teams?.find(
    team => team.id === registeredTeam?.id
  )

  const isMyTurn =
    roomRole === 'team' &&
    registeredTeam?.id === activeRoom?.currentTeamId

  const sortedTeams = [...(activeRoom?.teams || [])].sort(
    (a, b) => b.score - a.score
  )

  const board = activeRoom?.board || []

  const availableTargets = (activeRoom?.teams || []).filter(
    team =>
      team.id !== registeredTeam?.id &&
      team.score > 0
  )

  // ==========================================
  // 15. INTERFAZ PRINCIPAL
  // ==========================================

  return (
    <div className="app-shell">

      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">🧠</div>

          <div>
            <div className="brand-name">MEMORY CHALLENGE</div>
            <div className="brand-subtitle">BATALLA DE EQUIPOS</div>
          </div>
        </div>

        <div className="status">
          ● Plataforma en desarrollo
        </div>
      </header>

      {/* ================================== */}
      {/* PANTALLA DE INICIO */}
      {/* ================================== */}

      {screen === 'home' && (
        <main className="hero-section">

          <div className="hero-label">
            🎮 JUEGA · APRENDE · COMPITE
          </div>

          <h1 className="hero-title">
            MEMORY <span>CHALLENGE</span>
          </h1>

          <p className="hero-description">
            Pon a prueba tu memoria, trabaja en equipo y demuestra
            quién tiene la mejor estrategia.
          </p>

          <div className="action-grid">

            <article className="action-card">
              <div className="card-icon">👨‍🏫</div>
              <h2>Crear partida</h2>
              <p>El instructor crea una sala y configura los equipos.</p>

              <button
                className="btn"
                type="button"
                onClick={openCreateRoom}
              >
                Crear una partida →
              </button>
            </article>

            <article className="action-card">
              <div className="card-icon">👥</div>
              <h2>Unirse a una partida</h2>
              <p>Ingresa el código y registra tu equipo.</p>

              <button
                className="btn btn-secondary"
                type="button"
                onClick={openJoinRoom}
              >
                Ingresar a una partida →
              </button>
            </article>

          </div>

          <section className="features">
            <div className="feature">
              <strong>⏱️ 10 min</strong>
              <span>Duración de la partida</span>
            </div>

            <div className="feature">
              <strong>👥 Equipos</strong>
              <span>Competencia colaborativa</span>
            </div>

            <div className="feature">
              <strong>🧩 Memoria</strong>
              <span>Desafíos de parejas</span>
            </div>
          </section>
        </main>
      )}

      {/* ================================== */}
      {/* CREAR PARTIDA */}
      {/* ================================== */}

      {screen === 'create' && (
        <main className="form-section">

          <button className="back-button" onClick={goHome}>
            ← Volver al inicio
          </button>

          <div className="form-card">
            <div className="card-icon">👨‍🏫</div>
            <h1>Crear partida</h1>
            <p>Configura los datos de la competencia.</p>

            <form onSubmit={handleCreateRoom}>

              <label htmlFor="hostName">
                Nombre del instructor
              </label>

              <input
                id="hostName"
                type="text"
                placeholder="Escribe tu nombre"
                value={hostName}
                onChange={(event) => setHostName(event.target.value)}
                maxLength={30}
                required
              />

              <label htmlFor="maxTeams">
                Cantidad máxima de equipos
              </label>

              <select
                id="maxTeams"
                value={maxTeams}
                onChange={(event) => setMaxTeams(event.target.value)}
              >
                {[2, 3, 4, 5, 6, 7, 8].map(number => (
                  <option key={number} value={number}>
                    {number} equipos
                  </option>
                ))}
              </select>

              <div className="game-info">
                <span>⏱️ Duración: 10 minutos</span>
                <span>🎴 Tablero: 16 cartas</span>
                <span>⌛ Turno: 20 segundos</span>
              </div>

              <button className="btn" type="submit" disabled={loading}>
                {loading ? 'Creando partida...' : 'Crear partida →'}
              </button>

            </form>

            {message && (
              <div className="feedback-message" role="status">
                {message}
              </div>
            )}
          </div>
        </main>
      )}

      {/* ================================== */}
      {/* UNIRSE A PARTIDA */}
      {/* ================================== */}

      {screen === 'join' && (
        <main className="form-section">

          <button className="back-button" onClick={goHome}>
            ← Volver al inicio
          </button>

          <div className="form-card">
            <div className="card-icon">👥</div>
            <h1>Unirse a una partida</h1>
            <p>Ingresa los datos de tu equipo.</p>

            <form onSubmit={handleJoinRoom}>

              <label htmlFor="teamName">
                Nombre del equipo
              </label>

              <input
                id="teamName"
                type="text"
                placeholder="Ejemplo: Los campeones"
                value={teamName}
                onChange={(event) => setTeamName(event.target.value)}
                maxLength={30}
                required
              />

              <label htmlFor="accessCode">
                Código de acceso
              </label>

              <input
                id="accessCode"
                className="join-input"
                type="text"
                placeholder="ABC12"
                maxLength={5}
                value={accessCode}
                onChange={(event) =>
                  setAccessCode(
                    event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
                  )
                }
                required
              />

              <button className="btn" type="submit" disabled={loading}>
                {loading ? 'Registrando equipo...' : 'Ingresar a la partida →'}
              </button>

            </form>

            {message && (
              <div className="feedback-message" role="status">
                {message}
              </div>
            )}
          </div>
        </main>
      )}

      {/* ================================== */}
      {/* SALA DE ESPERA */}
      {/* ================================== */}

      {screen === 'waiting' && activeRoom && (
        <main className="form-section">

          <div className="form-card" style={{ maxWidth: '650px' }}>
            <div className="card-icon">🎮</div>

            <h1>Sala de espera</h1>

            <p>
              {roomRole === 'host'
                ? 'Comparte el código para que los equipos puedan ingresar.'
                : 'Tu equipo está registrado. Espera a que el instructor inicie la partida.'}
            </p>

            {roomRole === 'host' && (
              <>
                <p>Código de acceso:</p>

                <div
                  style={{
                    fontSize: '42px',
                    fontWeight: 'bold',
                    letterSpacing: '8px',
                    color: '#a78bfa',
                    margin: '15px 0'
                  }}
                >
                  {activeRoom.code}
                </div>

                <button className="btn" type="button" onClick={copyRoomCode}>
                  Copiar código
                </button>
              </>
            )}

            {roomRole === 'team' && registeredTeam && (
              <div style={{ margin: '20px 0' }}>
                <h2>¡Bienvenido, {registeredTeam.name}!</h2>
                <p>Tu equipo ya está dentro de la sala.</p>
              </div>
            )}

            <div
              style={{
                marginTop: '25px',
                padding: '20px',
                borderRadius: '12px',
                background: '#172554',
                color: '#ffffff',
                textAlign: 'left'
              }}
            >
              <h2 style={{ textAlign: 'center' }}>
                Equipos registrados
              </h2>

              <p style={{ textAlign: 'center' }}>
                {activeRoom.teams.length} de {activeRoom.maxTeams} equipos
              </p>

              {activeRoom.teams.length === 0 ? (
                <p style={{ textAlign: 'center' }}>
                  Esperando el ingreso del primer equipo...
                </p>
              ) : (
                <ol>
                  {activeRoom.teams.map(team => (
                    <li key={team.id} style={{ marginBottom: '12px' }}>
                      <strong>{team.name}</strong>
                      <span> — {team.score} puntos</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <p style={{ marginTop: '20px' }}>
              Estado: <strong>Esperando equipos</strong>
            </p>

            <p>
              Duración: {activeRoom.duration / 60} minutos
            </p>

            {roomRole === 'host' && (
              <button
                className="btn"
                type="button"
                onClick={handleStartGame}
                disabled={loading || activeRoom.teams.length < 2}
                style={{ marginTop: '15px' }}
              >
                {loading
                  ? 'Iniciando partida...'
                  : activeRoom.teams.length < 2
                    ? 'Esperando mínimo 2 equipos'
                    : '🚀 Iniciar partida'}
              </button>
            )}

            {roomRole === 'team' && (
              <p className="development-note">
                El instructor iniciará la partida cuando todos estén listos.
              </p>
            )}

            {message && (
              <div className="feedback-message" role="status">
                {message}
              </div>
            )}

            <button
              className="btn btn-secondary"
              type="button"
              style={{ marginTop: '15px' }}
              onClick={goHome}
            >
              Volver al inicio
            </button>
          </div>
        </main>
      )}

      {/* ================================== */}
      {/* TABLERO DE JUEGO */}
      {/* ================================== */}

      {screen === 'playing' && activeRoom && (
        <main className="form-section">

          <div className="form-card" style={{ maxWidth: '1000px' }}>

            <div className="card-icon">🧠</div>

            <h1>Memory Challenge</h1>

            <p>
              Sala: <strong>{activeRoom.code}</strong>
            </p>

            <div className="game-info">
              <span>
                ⏱️ Tiempo total: <strong>{formatTime(activeRoom.remainingSeconds)}</strong>
              </span>

              <span>
                ⌛ Tiempo del turno: <strong>{formatTime(activeRoom.turnRemainingSeconds)}</strong>
              </span>

              <span>
                🎯 Parejas: <strong>{activeRoom.matchedPairs || 0} / 8</strong>
              </span>
            </div>

            <section
              style={{
                marginTop: '20px',
                padding: '18px',
                borderRadius: '12px',
                background: isMyTurn ? '#14532d' : '#172554',
                color: '#ffffff'
              }}
            >
              <h2>
                Turno actual: {currentTeam?.name || 'Esperando equipo'}
              </h2>

              {roomRole === 'team' && (
                <p>
                  {isMyTurn
                    ? '¡Es tu turno! Selecciona dos cartas o utiliza un poder especial.'
                    : `Espera tu turno, ${registeredTeam?.name}.`}
                </p>
              )}

              {roomRole === 'host' && (
                <p>Vista del instructor: supervisión de la partida.</p>
              )}

              {activeRoom.isResolving && (
                <p>Resolviendo la jugada...</p>
              )}
            </section>

            {roomRole === 'team' && (
              <p style={{ marginTop: '15px' }}>
                Tu equipo: <strong>{registeredTeam?.name}</strong>
              </p>
            )}

            {/* ================================== */}
            {/* PODERES ESPECIALES */}
            {/* ================================== */}

            <section
              style={{
                marginTop: '25px',
                padding: '20px',
                borderRadius: '14px',
                background: '#111827',
                color: '#ffffff',
                textAlign: 'left',
                border: '1px solid #4f46e5'
              }}
            >
              <h2 style={{ textAlign: 'center' }}>
                ⚡ Poderes especiales
              </h2>

              <p style={{ textAlign: 'center', color: '#cbd5e1' }}>
                Cada equipo dispone de un uso de cada poder por partida.
              </p>

              {/* Estado de los poderes del equipo */}

              {roomRole === 'team' && myTeam && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                    gap: '10px',
                    marginTop: '18px'
                  }}
                >
                  <div style={powerStatusStyle}>
                    <strong>🪙 Robo</strong>
                    <span>{myTeam.powers?.steal ? 'Disponible' : 'Utilizado'}</span>
                  </div>

                  <div style={powerStatusStyle}>
                    <strong>🛡️ Escudo</strong>
                    <span>{myTeam.powers?.shield ? 'Protección activa' : 'Utilizado'}</span>
                  </div>

                  <div style={powerStatusStyle}>
                    <strong>✖️ Multiplicador x2</strong>
                    <span>{myTeam.powers?.double ? 'Disponible' : 'Utilizado'}</span>
                  </div>

                  <div style={powerStatusStyle}>
                    <strong>⚡ Desafío relámpago</strong>
                    <span>{myTeam.powers?.lightning ? 'Disponible' : 'Utilizado'}</span>
                  </div>
                </div>
              )}

              {/* Robo de puntos */}

              {roomRole === 'team' && (
                <div
                  style={{
                    marginTop: '22px',
                    padding: '18px',
                    background: '#1e293b',
                    borderRadius: '12px'
                  }}
                >
                  <h3>🪙 Robar puntos</h3>

                  <p style={{ color: '#cbd5e1' }}>
                    Selecciona un equipo y la cantidad de puntos que deseas robar.
                    Si el equipo tiene escudo, el robo será bloqueado.
                  </p>

                  {!myTeam?.powers?.steal ? (
                    <p style={{ color: '#fca5a5', fontWeight: 'bold' }}>
                      Este equipo ya utilizó su poder de robo.
                    </p>
                  ) : (
                    <>
                      <form onSubmit={handleStealPoints}>

                        <label
                          htmlFor="stealTarget"
                          style={{ display: 'block', marginTop: '12px' }}
                        >
                          Equipo objetivo
                        </label>

                        <select
                          id="stealTarget"
                          value={stealTarget}
                          onChange={(event) => setStealTarget(event.target.value)}
                          disabled={!isMyTurn || usingPower || activeRoom.isResolving}
                          style={powerInputStyle}
                          required
                        >
                          <option value="">Selecciona un equipo</option>

                          {availableTargets.map(team => (
                            <option key={team.id} value={team.id}>
                              {team.name} — {team.score} puntos
                              {team.powers?.shield ? ' 🛡️' : ''}
                            </option>
                          ))}
                        </select>

                        <label
                          htmlFor="stealAmount"
                          style={{ display: 'block', marginTop: '12px' }}
                        >
                          Cantidad de puntos
                        </label>

                        <select
                          id="stealAmount"
                          value={stealAmount}
                          onChange={(event) => setStealAmount(event.target.value)}
                          disabled={!isMyTurn || usingPower || activeRoom.isResolving}
                          style={powerInputStyle}
                        >
                          <option value="2">Robar 2 puntos</option>
                          <option value="5">Robar 5 puntos</option>
                          <option value="8">Robar 8 puntos</option>
                        </select>

                        <button
                          className="btn"
                          type="submit"
                          disabled={
                            !isMyTurn ||
                            usingPower ||
                            activeRoom.isResolving ||
                            !stealTarget ||
                            availableTargets.length === 0
                          }
                          style={{ marginTop: '15px', width: '100%' }}
                        >
                          {usingPower
                            ? 'Procesando robo...'
                            : !isMyTurn
                              ? 'Disponible en tu turno'
                              : '🪙 Confirmar robo de puntos'}
                        </button>
                      </form>

                      {availableTargets.length === 0 && (
                        <p style={{ color: '#fca5a5' }}>
                          No hay equipos con puntos disponibles para robar.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Escudo */}

              <div
                style={{
                  marginTop: '15px',
                  padding: '15px',
                  background: '#1e293b',
                  borderRadius: '12px'
                }}
              >
                <h3>🛡️ Protección con escudo</h3>
                <p style={{ color: '#cbd5e1' }}>
                  El escudo funciona automáticamente. Si otro equipo intenta
                  robarte puntos, bloqueará el ataque y se consumirá.
                </p>
              </div>

              {roomRole === 'host' && (
                <p style={{ color: '#cbd5e1', marginTop: '15px' }}>
                  El instructor puede supervisar el estado de los poderes de todos los equipos.
                </p>
              )}
            </section>

            {/* ================================== */}
            {/* TABLERO DE MEMORIA */}
            {/* ================================== */}

            <h2 style={{ marginTop: '25px' }}>Tablero de memoria</h2>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                gap: '12px',
                marginTop: '20px'
              }}
            >
              {board.map((card, index) => {
                const isVisible = card.revealed || card.matched

                const canSelect =
                  roomRole === 'team' &&
                  isMyTurn &&
                  !activeRoom.isResolving &&
                  !card.revealed &&
                  !card.matched &&
                  !loading &&
                  !usingPower

                return (
                  <button
                    key={card.id}
                    type="button"
                    disabled={!canSelect}
                    onClick={() => handleFlipCard(card)}
                    aria-label={
                      isVisible
                        ? `Carta ${index + 1}: ${card.symbol}`
                        : `Carta ${index + 1} oculta`
                    }
                    style={{
                      minHeight: '100px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '12px',
                      background: card.matched
                        ? '#166534'
                        : card.revealed
                          ? '#4338ca'
                          : '#312e81',
                      color: '#ffffff',
                      fontSize: '34px',
                      fontWeight: 'bold',
                      border: card.matched
                        ? '2px solid #4ade80'
                        : '2px solid #818cf8',
                      cursor: canSelect ? 'pointer' : 'not-allowed',
                      opacity: !canSelect && !isVisible ? 0.75 : 1,
                      transition: 'background 0.2s ease'
                    }}
                  >
                    {isVisible ? card.symbol : '?'}
                  </button>
                )
              })}
            </div>

            {/* ================================== */}
            {/* CLASIFICACION */}
            {/* ================================== */}

            <h2 style={{ marginTop: '30px' }}>
              Clasificación actual
            </h2>

            <ol style={{ textAlign: 'left' }}>
              {sortedTeams.map(team => (
                <li key={team.id} style={{ marginBottom: '12px' }}>
                  <strong>{team.name}</strong> — {team.score} puntos
                  {team.id === activeRoom.currentTeamId && ' 🟢 Turno actual'}
                </li>
              ))}
            </ol>

            {/* ================================== */}
            {/* MENSAJES */}
            {/* ================================== */}

            {message && (
              <div className="feedback-message" role="status">
                {message}
              </div>
            )}

            {roomRole === 'host' && (
              <p className="development-note">
                El instructor puede observar el tablero, los turnos, los puntos y los poderes.
              </p>
            )}
          </div>
        </main>
      )}

      {/* ================================== */}
      {/* PARTIDA FINALIZADA */}
      {/* ================================== */}

      {screen === 'finished' && activeRoom && (
        <main className="form-section">
          <div className="form-card" style={{ maxWidth: '700px' }}>
            <div className="card-icon">🏆</div>

            <h1>¡Partida finalizada!</h1>

            <p>Resultado final de Memory Challenge.</p>

            <h2>Equipo ganador</h2>

            {(activeRoom.winner || []).map(team => (
              <p key={team.id}>
                🏆 <strong>{team.name}</strong>
              </p>
            ))}

            <h2 style={{ marginTop: '25px' }}>Clasificación final</h2>

            <ol style={{ textAlign: 'left' }}>
              {sortedTeams.map(team => (
                <li key={team.id} style={{ marginBottom: '12px' }}>
                  <strong>{team.name}</strong> — {team.score} puntos
                </li>
              ))}
            </ol>

            <button className="btn" type="button" onClick={goHome}>
              Volver al inicio
            </button>
          </div>
        </main>
      )}

      {/* ================================== */}
      {/* ESTADO DE CONEXION */}
      {/* ================================== */}

      <div className="connection-indicator">
        <span className={connectionStatus === 'Conectado' ? 'online-dot' : 'offline-dot'}>
          ●
        </span>

        Backend: {connectionStatus}
      </div>

      <footer className="footer">
        MEMORY CHALLENGE © 2026 · BATALLA DE EQUIPOS
      </footer>

    </div>
  )
}

// ==========================================
// ESTILOS DE LOS PODERES
// ==========================================

const powerStatusStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '7px',
  padding: '12px',
  borderRadius: '10px',
  background: '#334155',
  textAlign: 'center',
  fontSize: '14px'
}

const powerInputStyle = {
  display: 'block',
  width: '100%',
  padding: '12px',
  marginTop: '7px',
  borderRadius: '8px',
  border: '1px solid #64748b',
  background: '#ffffff',
  color: '#111827',
  fontSize: '15px'
}

export default App
