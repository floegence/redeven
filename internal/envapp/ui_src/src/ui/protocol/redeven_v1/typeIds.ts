export const redevenV1TypeIds = {
  fs: {
    list: 1001,
    readFile: 1002,
    writeFile: 1003,
    rename: 1004,
    copy: 1005,
    delete: 1006,
    getHome: 1010,
  },
  terminal: {
    sessionCreate: 2001,
    sessionList: 2002,
    sessionAttach: 2003,

    output: 2004, // notify (agent -> client)
    resize: 2005, // notify (client -> agent)
    input: 2006, // notify (client -> agent)
    history: 2007,
    clear: 2008,

    sessionDelete: 2009,
    nameUpdate: 2010, // notify (agent -> client)
    sessionStats: 2011,
    sessionsChanged: 2012, // notify (agent -> client)
  },
  monitor: {
    sysMonitor: 3001,
  },
  sessions: {
    listActive: 5001,
  },
  sys: {
    ping: 4001,
  },
} as const;
