HOST = null; // localhost
PORT = 8001;

// when the daemon started
var starttime = (new Date()).getTime();

var mem = process.memoryUsage();
// every 10 seconds poll for the memory.
setInterval(function () {
  mem = process.memoryUsage();
}, 10*1000);

var rooms = {};


var fu = require("./fu"),
    sys = require("sys"),
    url = require("url"),
    qs = require("querystring");

var MESSAGE_BACKLOG = 200,
    SESSION_TIMEOUT = 60 * 1000;

	
function createRoom(newRoom) //title, creator)
{
	var id = randomString();
  rooms[id] = {};
  rooms[id].population = 1;

	rooms[id].channel = new function () {
  var messages = [],
      callbacks = [];

  this.appendMessage = function (name, type, text) {
    var m = { name: name
            , type: type // "msg", "join", "part"
            , text: text
            , timestamp: (new Date()).getTime()
            };

    switch (type) {
      case "msg":
        sys.puts("<" + name + "> " + text);
        break;
      case "join":
        sys.puts(name + " join");
        break;
      case "part":
        sys.puts(name + " part");
        break;
    }

    messages.push( m );

    while (callbacks.length > 0) {
      callbacks.shift().callback([m]);
    }

    while (messages.length > MESSAGE_BACKLOG)
      messages.shift();
  };

  this.query = function (since, callback) {
    var matching = [];
    for (var i = 0; i < messages.length; i++) {
      var message = messages[i];
      if (message.timestamp > since)
        matching.push(message)
    }

    if (matching.length != 0) {
      callback(matching);
    } else {
      callbacks.push({ timestamp: new Date(), callback: callback });
    }
  };

  // clear old callbacks
  // they can hang around for at most 30 seconds.
  setInterval(function () {
    var now = new Date();
    while (callbacks.length > 0 && now - callbacks[0].timestamp > 30*1000) {
      callbacks.shift().callback([]);
    }
  }, 3000);
};
  
	rooms[id].sessions = {};
	rooms[id].title = newRoom.title;
	rooms[id].creator = newRoom.creator;
  return id;
}

function createSession (user) {

  console.log('weeee');
  console.log(user.room);
  console.log(rooms[user.room]);
   if(rooms[user.room] == null)
	return null;
  for (var i in rooms[user.room].sessions) {
    var session = rooms[user.room].sessions[i];
    if (session && session.id == user.id) return null;
  }

  var session = { 
    name: user.name, 
    id: user.id,
	profile: user.profile,
	pic: user.pic,
	room: user.room,
    timestamp: new Date(),

    poke: function () {
      session.timestamp = new Date();
    },

    destroy: function () {
      rooms[user.room].channel.appendMessage(session.name, "part");
      delete rooms[user.room].sessions[session.id];
    }
  };

  rooms[user.room].sessions[session.id] = session;
  return session;
}

// interval to kill off old sessions
setInterval(function () {
  var now = new Date();/*
  for (var id in sessions) {
    if (!sessions.hasOwnProperty(id)) continue;
    var session = sessions[id];

    if (now - session.timestamp > SESSION_TIMEOUT) {
      session.destroy();
    }
  }*/
}, 1000);

fu.listen(Number(process.env.PORT || PORT), HOST);

fu.get("/", fu.staticHandler("index.html"));
fu.get("/style.css", fu.staticHandler("style.css"));
fu.get("/client.js", fu.staticHandler("client.js"));
fu.get("/jquery-1.2.6.min.js", fu.staticHandler("jquery-1.2.6.min.js"));


fu.get("/getchats", function (req, res) {
  var allChats = {};
  console.log(rooms);
  for(prop in rooms)
  {
  console.log(prop);
	allChats[prop] = rooms[prop];
  }
  res.simpleJSON(200, { rooms: allChats
                      });
});


fu.get("/who", function (req, res) {
  var names = [];
  var roomId = qs.parse(url.parse(req.url).query).room;
  for (var id in rooms[roomId].sessions) {
    if (!rooms[roomId].sessions.hasOwnProperty(id)) continue;
    var session = rooms[roomId].sessions[id];
    names.push(session.name);
  }
  res.simpleJSON(200, { names: names
                      , rss: mem.rss
                      });
});

fu.get("/join", function (req, res) {
	var user = qs.parse(url.parse(req.url).query);
  if (user.id == null) {
    res.simpleJSON(400, {error: "Bad login."});
    return;
  }
  var session = createSession(user);
  if (session == null) {
    res.simpleJSON(400, {error: "Already logged in?"});
    return;
  }

  //sys.puts("connection: " + name + "@" + res.connection.remoteAddress);

  rooms[session.room].channel.appendMessage(session.name, "join");
  res.simpleJSON(200, { id: user.id
                      , name: user.name
                      , rss: mem.rss
                      , starttime: starttime
                      });
});



fu.get("/create", function (req, res) {
	
	var newroom = qs.parse(url.parse(req.url).query);
	var title = newroom.title;
  if (newroom.id == 'null') {
    res.simpleJSON(400, {error: "Bad login."});
    return;
  }
  var roomId = createRoom({title: newroom.title, name: newroom.name});
  newroom.room = roomId;
  var session = createSession(newroom);
  if (session == null) {
    res.simpleJSON(400, {error: "Already logged in?"});
    return;
  }

	
  rooms[session.room].channel.appendMessage(session.name, "join");
  res.simpleJSON(200, { id: newroom.id
                      , name: newroom.name
                      , room: newroom.room
                      , rss: mem.rss
                      , starttime: starttime
                      });
});


//todo: deal w this
fu.get("/part", function (req, res) {
  var stuff = qs.parse(url.parse(req.url).query);

  if (stuff && stuff.room && stuff.id && rooms[stuff.room]) {
    session = rooms[stuff.room].sessions[stuff.id];
	 if(!(rooms[stuff.room].population--))
	 {
		delete rooms[stuff.room];
	 }
    session.destroy();
  }

  // get rid of stuff[room]
  res.simpleJSON(200, { rss: mem.rss });
});


fu.get("/recv", function (req, res) {
	var thing = qs.parse(url.parse(req.url).query);
  if (!thing.since) {
    res.simpleJSON(400, { error: "Must supply since parameter" });
    return;
  }
  var id = qs.parse(url.parse(req.url).query).id;
  var session;
  if (id && rooms[thing.room].sessions[id]) {
    session = rooms[thing.room].sessions[id];
    session.poke();
  }

  var since = parseInt(qs.parse(url.parse(req.url).query).since, 10);

  rooms[thing.room].channel.query(since, function (messages) {
    if (session) session.poke();
    res.simpleJSON(200, { messages: messages, rss: mem.rss });
  });
});

fu.get("/send", function (req, res) {
  var id = qs.parse(url.parse(req.url).query).id;
  var text = qs.parse(url.parse(req.url).query).text;
  var room = qs.parse(url.parse(req.url).query).room;

  var session = rooms[room].sessions[id];
  if (!session || !text) {
    res.simpleJSON(400, { error: "No such session id" });
    return;
  }

  session.poke();

  rooms[session.room].channel.appendMessage(session.name, "msg", text, session.profile);
  res.simpleJSON(200, { rss: mem.rss });
});


function randomString() {
	var chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz";
	var string_length = 8;
	var randomstring = '';
	for (var i=0; i<string_length; i++) {
		var rnum = Math.floor(Math.random() * chars.length);
		randomstring += chars.substring(rnum,rnum+1);
	}
  return randomstring;
}
