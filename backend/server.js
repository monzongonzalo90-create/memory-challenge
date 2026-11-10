
const express = require('express')
const cors = require('cors')
const http = require('http')
const { Server } = require('socket.io')
const crypto = require('crypto')
require('dotenv').config()

// ==========================================
// 1. CONFIGURACION GENERAL
// ==========================================

const app = express()
const server = http.createServer(app)

const PORT = process.env.PORT || 3001
const FRONTEND_URL = 'http://localhost:5173'

const rooms = new Map()

app.use(cors({
  origin: FRONTEND_URL,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'x-host-token']
}))

app.use(express.json())

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ['GET', 'POST']
  }
})

// ==========================================
// 2. GENERAR CODIGO DE ACCESO
// ==========================================

function generateRoomCode() {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code

  do {
    code = ''

    for (let i = 0; i < 5; i++) {
      code += characters[crypto.randomInt(0, characters.length)]
    }
  } while (rooms.has(code))

  return code
}

// ==========================================
// 3. GENERAR TABLERO
// ==========================================

function generateBoard() {
  const symbols = [
    '🍎', '🚀', '🎯', '⚽',
    '🎮', '⭐', '🐱', '🌎'
  ]

  const cards = symbols.flatMap((symbol, index) => [
    {
      id: `${index}-A`,
      pairId: index,
      symbol,
      revealed: false,
      matched: false
    },
    {
      id: `${index}-B`,
      pairId: index,
      symbol,
      revealed: false,
      matched: false
    }
  ])

  for (let i = cards.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1)
    ;[cards[i], cards[j]] = [cards[j], cards[i]]
  }

  return cards
}

// ==========================================
// 4. INFORMACION PUBLICA DE LA PARTIDA
// ==========================================

function getPublicRoom(room) {
  const publicBoard = room.board.map(card => ({
    id: card.id,
    symbol: card.revealed || card.matched ? card.symbol : null,
    revealed: card.revealed,
    matched: card.matched
  }))

  const publicTeams = room.teams.map(team => ({
    id: team.id,
    name: team.name,
    score: team.score,

    powers: {
      steal: Boolean(team.powers?.steal),
      double: Boolean(team.powers?.double),
      shield: Boolean(team.powers?.shield),
      lightning: Boolean(team.powers?.lightning)
    },

    // Indica si el multiplicador está esperando
    // una pareja correcta.
    doubleActive: Boolean(team.doubleActive),

    joinedAt: team.joinedAt
  }))

  return {
    code: room.code,
    hostName: room.hostName,
    maxTeams: room.maxTeams,
    teams: publicTeams,
    status: room.status,
    duration: room.duration,
    turnDuration: room.turnDuration,
    boardCards: room.boardCards,
    board: publicBoard,
    startedAt: room.startedAt,
    currentTeamIndex: room.currentTeamIndex,
    currentTeamId: room.teams[room.currentTeamIndex]?.id || null,
    remainingSeconds: room.remainingSeconds,
    turnRemainingSeconds: room.turnRemainingSeconds,
    matchedPairs: room.matchedPairs,
    isResolving: room.isResolving,
    winner: room.winner || null
  }
}

// ==========================================
// 5. NOTIFICAR CAMBIOS
// ==========================================

function broadcastRoom(room) {
  io.to(room.code).emit('room-updated', getPublicRoom(room))
}

// ==========================================
// 6. CONTROL DE TURNOS
// ==========================================

function advanceTurn(room) {
  if (room.status !== 'playing') return

  room.pendingCards = []
  room.isResolving = false

  room.board.forEach(card => {
    if (!card.matched) {
      card.revealed = false
    }
  })

  room.currentTeamIndex =
    (room.currentTeamIndex + 1) % room.teams.length

  room.turnRemainingSeconds = room.turnDuration

  console.log(
    'SIGUIENTE TURNO:',
    room.teams[room.currentTeamIndex].name
  )

  broadcastRoom(room)
}

// ==========================================
// 7. FINALIZAR PARTIDA
// ==========================================

function stopRoomTimers(room) {
  if (room.timerInterval) {
    clearInterval(room.timerInterval)
    room.timerInterval = null
  }

  if (room.mismatchTimeout) {
    clearTimeout(room.mismatchTimeout)
    room.mismatchTimeout = null
  }
}

function finishGame(room) {
  if (room.status !== 'playing') return

  room.status = 'finished'
  room.pendingCards = []
  room.isResolving = false

  const highestScore = Math.max(
    ...room.teams.map(team => team.score)
  )

  const winners = room.teams.filter(
    team => team.score === highestScore
  )

  // Los equipos que no ganaron pierden 2 puntos.
  room.teams.forEach(team => {
    if (team.score < highestScore) {
      team.score -= 2
    }
  })

  room.winner = winners.map(team => ({
    id: team.id,
    name: team.name
  }))

  stopRoomTimers(room)

  console.log('PARTIDA FINALIZADA:', room.code)

  console.log(
    'GANADOR(ES):',
    room.winner.map(team => team.name)
  )

  broadcastRoom(room)

  io.to(room.code).emit('game-finished', {
    room: getPublicRoom(room),
    winner: room.winner
  })
}

// ==========================================
// 8. TEMPORIZADORES
// ==========================================

function startRoomTimer(room) {
  stopRoomTimers(room)

  room.timerInterval = setInterval(() => {
    if (room.status !== 'playing') {
      stopRoomTimers(room)
      return
    }

    room.remainingSeconds -= 1

    if (!room.isResolving) {
      room.turnRemainingSeconds -= 1
    }

    // Finalizar cuando se agotan los 10 minutos.
    if (room.remainingSeconds <= 0) {
      room.remainingSeconds = 0
      finishGame(room)
      return
    }

    // Penalización por agotar el tiempo del turno.
    if (room.turnRemainingSeconds <= 0) {
      const currentTeam = room.teams[room.currentTeamIndex]

      if (currentTeam) {
        currentTeam.score -= 1

        console.log(
          'TIEMPO AGOTADO:',
          currentTeam.name,
          'Pierde 1 punto.'
        )
      }

      advanceTurn(room)
      return
    }

    broadcastRoom(room)
  }, 1000)
}

// ==========================================
// 9. VALIDAR Y SELECCIONAR CARTAS
// ==========================================

function flipCard(room, teamId, cardId) {
  if (room.status !== 'playing') {
    return {
      success: false,
      message: 'La partida no está activa.'
    }
  }

  if (room.isResolving) {
    return {
      success: false,
      message: 'Espera a que se resuelva la jugada anterior.'
    }
  }

  const currentTeam = room.teams[room.currentTeamIndex]

  if (!currentTeam || currentTeam.id !== teamId) {
    return {
      success: false,
      message: 'No es el turno de tu equipo.'
    }
  }

  const card = room.board.find(item => item.id === cardId)

  if (!card) {
    return {
      success: false,
      message: 'La carta seleccionada no existe.'
    }
  }

  if (card.matched || card.revealed) {
    return {
      success: false,
      message: 'Esta carta ya está descubierta.'
    }
  }

  card.revealed = true
  room.pendingCards.push(card.id)

  // Primera carta seleccionada.
  if (room.pendingCards.length === 1) {
    broadcastRoom(room)

    return {
      success: true,
      message: 'Primera carta seleccionada.'
    }
  }

  const firstCard = room.board.find(
    item => item.id === room.pendingCards[0]
  )

  const secondCard = card

  room.isResolving = true

  // ========================================
  // PAREJA CORRECTA
  // ========================================

  if (firstCard.pairId === secondCard.pairId) {
    firstCard.matched = true
    secondCard.matched = true

    // Comprobar si el equipo tiene x2 activo.
    const usedDouble = Boolean(currentTeam.doubleActive)

    // Sin multiplicador gana 1 punto.
    // Con multiplicador gana 2 puntos.
    const pointsEarned = usedDouble ? 2 : 1

    currentTeam.score += pointsEarned

    // Consumir el multiplicador.
    if (usedDouble) {
      currentTeam.doubleActive = false

      console.log(
        'MULTIPLICADOR x2 UTILIZADO:',
        currentTeam.name,
        '+2 PUNTOS'
      )
    }

    room.matchedPairs += 1

    room.pendingCards = []
    room.isResolving = false

    console.log(
      'PAREJA CORRECTA:',
      currentTeam.name,
      `+${pointsEarned} PUNTO(S)`
    )

    if (room.matchedPairs === room.boardCards / 2) {
      finishGame(room)
    } else {
      advanceTurn(room)
    }

    return {
      success: true,
      message: usedDouble
        ? '¡Multiplicador x2! Tu equipo gana 2 puntos.'
        : '¡Pareja correcta! Tu equipo gana 1 punto.',
      matched: true,
      pointsEarned
    }
  }

  // ========================================
  // PAREJA INCORRECTA
  // ========================================

  broadcastRoom(room)

  room.mismatchTimeout = setTimeout(() => {
    room.mismatchTimeout = null

    if (room.status === 'playing') {
      advanceTurn(room)
    }
  }, 1500)

  return {
    success: true,
    message: 'Pareja incorrecta. El turno cambiará.',
    matched: false
  }
}

// ==========================================
// 10. PODER ESPECIAL: ROBAR PUNTOS
// ==========================================

function stealPoints(room, attackerId, targetId, requestedAmount) {
  if (room.status !== 'playing') {
    return {
      success: false,
      message: 'La partida no está activa.'
    }
  }

  if (room.isResolving) {
    return {
      success: false,
      message: 'Espera a que termine la jugada actual.'
    }
  }

  const attacker = room.teams[room.currentTeamIndex]

  if (!attacker || attacker.id !== attackerId) {
    return {
      success: false,
      message: 'Solo el equipo que tiene el turno puede utilizar este poder.'
    }
  }

  if (![2, 5, 8].includes(requestedAmount)) {
    return {
      success: false,
      message: 'Solo puedes intentar robar 2, 5 u 8 puntos.'
    }
  }

  if (!attacker.powers || !attacker.powers.steal) {
    return {
      success: false,
      message: 'Tu equipo ya utilizó el poder de robo.'
    }
  }

  if (attackerId === targetId) {
    return {
      success: false,
      message: 'No puedes robar puntos a tu propio equipo.'
    }
  }

  const target = room.teams.find(
    team => team.id === targetId
  )

  if (!target) {
    return {
      success: false,
      message: 'El equipo seleccionado no existe.'
    }
  }

  if (target.score <= 0) {
    return {
      success: false,
      message: 'El equipo seleccionado no tiene puntos para robar.'
    }
  }

  // Consumir el intento de robo válido.
  attacker.powers.steal = false

  // El escudo bloquea automáticamente el robo.
  if (target.powers && target.powers.shield) {
    target.powers.shield = false

    console.log(
      'ROBO BLOQUEADO:',
      target.name,
      'PROTEGIDO POR SU ESCUDO.'
    )

    broadcastRoom(room)

    return {
      success: true,
      blocked: true,
      stolenAmount: 0,
      message: `¡El escudo de ${target.name} bloqueó el robo!`
    }
  }

  // No se pueden robar más puntos de los disponibles.
  const stolenAmount = Math.min(
    requestedAmount,
    target.score
  )

  target.score -= stolenAmount
  attacker.score += stolenAmount

  console.log(
    'ROBO DE PUNTOS:',
    attacker.name,
    'robó',
    stolenAmount,
    'puntos a',
    target.name
  )

  broadcastRoom(room)

  return {
    success: true,
    blocked: false,
    stolenAmount,
    message: `${attacker.name} robó ${stolenAmount} puntos a ${target.name}.`
  }
}

// ==========================================
// 11. PODER ESPECIAL: MULTIPLICADOR x2
// ==========================================

function activateDouble(room, teamId) {
  if (room.status !== 'playing') {
    return {
      success: false,
      message: 'La partida no está activa.'
    }
  }

  if (room.isResolving) {
    return {
      success: false,
      message: 'Espera a que termine la jugada actual.'
    }
  }

  const currentTeam = room.teams[room.currentTeamIndex]

  if (!currentTeam || currentTeam.id !== teamId) {
    return {
      success: false,
      message: 'Solo el equipo que tiene el turno puede activar el multiplicador.'
    }
  }

  if (!currentTeam.powers || !currentTeam.powers.double) {
    return {
      success: false,
      message: 'Tu equipo ya utilizó el multiplicador x2.'
    }
  }

  if (currentTeam.doubleActive) {
    return {
      success: false,
      message: 'El multiplicador x2 ya está activo.'
    }
  }

  // Consumir el poder.
  currentTeam.powers.double = false

  // Dejar el multiplicador pendiente.
  currentTeam.doubleActive = true

  console.log(
    'MULTIPLICADOR x2 ACTIVADO:',
    currentTeam.name
  )

  broadcastRoom(room)

  return {
    success: true,
    message: '¡Multiplicador x2 activado! Tu próxima pareja correcta vale 2 puntos.',
    doubleActive: true
  }
}

// ==========================================
// 12. RUTA PRINCIPAL
// ==========================================

app.get('/', (req, res) => {
  res.json({
    proyecto: 'Memory Challenge',
    mensaje: 'Backend funcionando correctamente',
    estado: 'Activo',
    etapa: 6.5
  })
})

// ==========================================
// 13. CONSULTAR PARTIDAS
// ==========================================

app.get('/api/rooms', (req, res) => {
  const activeRooms = Array.from(rooms.values())
    .map(getPublicRoom)

  res.json({
    total: activeRooms.length,
    partidas: activeRooms
  })
})

// ==========================================
// 14. CREAR PARTIDA
// ==========================================

app.post('/api/rooms', (req, res) => {
  try {
    const { hostName, maxTeams } = req.body

    if (
      typeof hostName !== 'string' ||
      !hostName.trim() ||
      hostName.trim().length > 30
    ) {
      return res.status(400).json({
        success: false,
        message: 'El nombre del instructor es obligatorio y no debe superar 30 caracteres.'
      })
    }

    const teamLimit = Number(maxTeams)

    if (
      !Number.isInteger(teamLimit) ||
      teamLimit < 2 ||
      teamLimit > 8
    ) {
      return res.status(400).json({
        success: false,
        message: 'La cantidad de equipos debe estar entre 2 y 8.'
      })
    }

    const roomCode = generateRoomCode()
    const hostToken = crypto.randomUUID()

    const newRoom = {
      code: roomCode,
      hostName: hostName.trim(),
      hostToken,
      maxTeams: teamLimit,
      teams: [],
      status: 'waiting',
      duration: 600,
      turnDuration: 20,
      boardCards: 16,
      board: [],
      startedAt: null,
      currentTeamIndex: 0,
      remainingSeconds: 600,
      turnRemainingSeconds: 20,
      matchedPairs: 0,
      pendingCards: [],
      isResolving: false,
      winner: null,
      timerInterval: null,
      mismatchTimeout: null,
      createdAt: new Date().toISOString()
    }

    rooms.set(roomCode, newRoom)

    console.log('PARTIDA CREADA:', roomCode)

    io.emit('room-created', getPublicRoom(newRoom))

    return res.status(201).json({
      success: true,
      message: 'Partida creada correctamente.',
      hostToken,
      room: getPublicRoom(newRoom)
    })
  } catch (error) {
    console.error('Error al crear partida:', error)

    return res.status(500).json({
      success: false,
      message: 'Error interno al crear la partida.'
    })
  }
})

// ==========================================
// 15. CONSULTAR PARTIDA
// ==========================================

app.get('/api/rooms/:code', (req, res) => {
  const code = req.params.code.toUpperCase().trim()
  const room = rooms.get(code)

  if (!room) {
    return res.status(404).json({
      success: false,
      message: 'No existe una partida con ese código.'
    })
  }

  return res.json({
    success: true,
    room: getPublicRoom(room)
  })
})

// ==========================================
// 16. REGISTRAR EQUIPO
// ==========================================

app.post('/api/rooms/:code/teams', (req, res) => {
  try {
    const code = req.params.code.toUpperCase().trim()
    const { teamName } = req.body

    const room = rooms.get(code)

    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'El código ingresado no corresponde a una partida.'
      })
    }

    if (room.status !== 'waiting') {
      return res.status(400).json({
        success: false,
        message: 'Esta partida ya no está aceptando equipos.'
      })
    }

    if (
      typeof teamName !== 'string' ||
      teamName.trim().length < 2 ||
      teamName.trim().length > 30
    ) {
      return res.status(400).json({
        success: false,
        message: 'El nombre debe tener entre 2 y 30 caracteres.'
      })
    }

    const cleanTeamName = teamName.trim()

    if (room.teams.length >= room.maxTeams) {
      return res.status(400).json({
        success: false,
        message: 'La partida ya alcanzó el máximo de equipos.'
      })
    }

    const duplicateTeam = room.teams.some(
      team => team.name.toLowerCase() === cleanTeamName.toLowerCase()
    )

    if (duplicateTeam) {
      return res.status(409).json({
        success: false,
        message: 'Ya existe un equipo con ese nombre.'
      })
    }

    const newTeam = {
      id: crypto.randomUUID(),
      name: cleanTeamName,
      score: 0,

      powers: {
        steal: true,
        double: true,
        shield: true,
        lightning: true
      },

      // Estado inicial del multiplicador.
      doubleActive: false,

      joinedAt: new Date().toISOString()
    }

    room.teams.push(newTeam)

    console.log('EQUIPO REGISTRADO:', newTeam.name)

    broadcastRoom(room)

    return res.status(201).json({
      success: true,
      message: 'Equipo registrado correctamente.',
      team: newTeam,
      room: getPublicRoom(room)
    })
  } catch (error) {
    console.error('Error al registrar equipo:', error)

    return res.status(500).json({
      success: false,
      message: 'Error interno al registrar el equipo.'
    })
  }
})

// ==========================================
// 17. INICIAR PARTIDA
// ==========================================

app.post('/api/rooms/:code/start', (req, res) => {
  try {
    const code = req.params.code.toUpperCase().trim()
    const room = rooms.get(code)

    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'La partida no existe.'
      })
    }

    const hostToken = req.headers['x-host-token']

    if (!hostToken || hostToken !== room.hostToken) {
      return res.status(403).json({
        success: false,
        message: 'No tienes autorización para iniciar esta partida.'
      })
    }

    if (room.status !== 'waiting') {
      return res.status(400).json({
        success: false,
        message: 'Esta partida ya fue iniciada o finalizada.'
      })
    }

    if (room.teams.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Se necesitan al menos dos equipos para iniciar.'
      })
    }

    room.board = generateBoard()
    room.status = 'playing'
    room.startedAt = new Date().toISOString()
    room.currentTeamIndex = 0
    room.remainingSeconds = room.duration
    room.turnRemainingSeconds = room.turnDuration
    room.matchedPairs = 0
    room.pendingCards = []
    room.isResolving = false

    // Reiniciar estados del multiplicador al comenzar.
    room.teams.forEach(team => {
      team.doubleActive = false
    })

    console.log('PARTIDA INICIADA:', room.code)

    broadcastRoom(room)
    io.to(room.code).emit('game-started', getPublicRoom(room))

    startRoomTimer(room)

    return res.json({
      success: true,
      message: 'La partida ha comenzado correctamente.',
      room: getPublicRoom(room)
    })
  } catch (error) {
    console.error('Error al iniciar partida:', error)

    return res.status(500).json({
      success: false,
      message: 'Error interno al iniciar la partida.'
    })
  }
})

// ==========================================
// 18. SELECCIONAR CARTA
// ==========================================

app.post('/api/rooms/:code/flip', (req, res) => {
  try {
    const code = req.params.code.toUpperCase().trim()
    const { teamId, cardId } = req.body

    const room = rooms.get(code)

    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'La partida no existe.'
      })
    }

    if (
      typeof teamId !== 'string' ||
      typeof cardId !== 'string'
    ) {
      return res.status(400).json({
        success: false,
        message: 'Faltan los datos del equipo o de la carta.'
      })
    }

    const result = flipCard(room, teamId, cardId)

    if (!result.success) {
      return res.status(400).json(result)
    }

    return res.json({
      ...result,
      room: getPublicRoom(room)
    })
  } catch (error) {
    console.error('Error al seleccionar carta:', error)

    return res.status(500).json({
      success: false,
      message: 'Error interno al seleccionar la carta.'
    })
  }
})

// ==========================================
// 19. UTILIZAR PODER DE ROBO
// ==========================================

app.post('/api/rooms/:code/powers/steal', (req, res) => {
  try {
    const code = req.params.code.toUpperCase().trim()
    const { teamId, targetId, amount } = req.body

    const room = rooms.get(code)

    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'La partida no existe.'
      })
    }

    if (
      typeof teamId !== 'string' ||
      typeof targetId !== 'string'
    ) {
      return res.status(400).json({
        success: false,
        message: 'Faltan los datos de los equipos.'
      })
    }

    const requestedAmount = Number(amount)

    if (!Number.isInteger(requestedAmount)) {
      return res.status(400).json({
        success: false,
        message: 'La cantidad de puntos debe ser un número entero.'
      })
    }

    const result = stealPoints(
      room,
      teamId,
      targetId,
      requestedAmount
    )

    if (!result.success) {
      return res.status(400).json(result)
    }

    return res.json({
      ...result,
      room: getPublicRoom(room)
    })
  } catch (error) {
    console.error('Error al utilizar el poder de robo:', error)

    return res.status(500).json({
      success: false,
      message: 'Error interno al utilizar el poder de robo.'
    })
  }
})

// ==========================================
// 20. ACTIVAR MULTIPLICADOR x2
// ==========================================

app.post('/api/rooms/:code/powers/double', (req, res) => {
  try {
    const code = req.params.code.toUpperCase().trim()
    const { teamId } = req.body

    const room = rooms.get(code)

    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'La partida no existe.'
      })
    }

    if (typeof teamId !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Falta el identificador del equipo.'
      })
    }

    const result = activateDouble(room, teamId)

    if (!result.success) {
      return res.status(400).json(result)
    }

    return res.json({
      ...result,
      room: getPublicRoom(room)
    })
  } catch (error) {
    console.error('Error al activar el multiplicador x2:', error)

    return res.status(500).json({
      success: false,
      message: 'Error interno al activar el multiplicador.'
    })
  }
})

// ==========================================
// 21. SOCKET.IO
// ==========================================

io.on('connection', socket => {
  console.log('DISPOSITIVO CONECTADO:', socket.id)

  socket.on('join-room', data => {
    const code = String(data?.code || '')
      .toUpperCase()
      .trim()

    const room = rooms.get(code)

    if (!room) {
      socket.emit('room-error', {
        message: 'La partida no existe.'
      })
      return
    }

    socket.join(code)

    console.log('DISPOSITIVO INGRESÓ A LA SALA:', code)

    socket.emit('room-updated', getPublicRoom(room))

    if (room.status === 'playing') {
      socket.emit('game-started', getPublicRoom(room))
    }

    if (room.status === 'finished') {
      socket.emit('game-finished', {
        room: getPublicRoom(room),
        winner: room.winner
      })
    }
  })

  socket.on('disconnect', reason => {
    console.log(
      'DISPOSITIVO DESCONECTADO:',
      socket.id,
      reason
    )
  })
})

// ==========================================
// 22. RUTA NO ENCONTRADA
// ==========================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Ruta no encontrada.'
  })
})

// ==========================================
// 23. MANEJO GENERAL DE ERRORES
// ==========================================

app.use((error, req, res, next) => {
  console.error('ERROR DEL SERVIDOR:', error)

  res.status(500).json({
    success: false,
    message: 'Se produjo un error interno en el servidor.'
  })
})

// ==========================================
// 24. INICIAR SERVIDOR
// ==========================================

server.listen(PORT, () => {
  console.log('====================================')
  console.log('MEMORY CHALLENGE - SERVIDOR ACTIVO')
  console.log(`Servidor: http://localhost:${PORT}`)
  console.log(`Frontend autorizado: ${FRONTEND_URL}`)
  console.log('Socket.IO: preparado')
  console.log('Creación de partidas: disponible')
  console.log('Registro de equipos: disponible')
  console.log('Selección de cartas: disponible')
  console.log('Control de turnos: disponible')
  console.log('Temporizadores: disponibles')
  console.log('Poder de robo: disponible')
  console.log('Escudo: disponible')
  console.log('Multiplicador x2: disponible')
  console.log('====================================')
})

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`El puerto ${PORT} ya está ocupado.`)
    console.error('Comprueba si ya existe otro backend activo.')
  } else {
    console.error('Error del servidor HTTP:', error)
  }
})
