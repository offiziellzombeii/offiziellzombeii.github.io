// data/season-2020.js – built-in data pack (made with tools/pack-builder.html)
// Jolpica F1 API (results 2020), bacinger/f1-circuits (layouts, MIT licence) – built 2026-11-12
registerPack({
"format": "rc-pack", "version": 1, "id": "season-2020", "name": "Formula 1 2020 (Jolpica)", "source": "Jolpica F1 API (results 2020), bacinger/f1-circuits (layouts, MIT licence) – built 2026-11-12",
"circuits": [
{"key":2,"meetings":[{"year":2020,"gp":"British Grand Prix","date":"2020-08-02","laps":52,"sprint":null,"race":null},{"year":2020,"gp":"70th Anniversary Grand Prix","date":"2020-08-09","laps":52,"sprint":null,"race":null}]},
{"key":4,"meetings":[{"year":2020,"gp":"Hungarian Grand Prix","date":"2020-07-19","laps":70,"sprint":null,"race":null}]},
{"key":6,"meetings":[{"year":2020,"gp":"Emilia Romagna Grand Prix","date":"2020-11-01","laps":63,"sprint":null,"race":null}]},
{"key":7,"meetings":[{"year":2020,"gp":"Belgian Grand Prix","date":"2020-08-30","laps":44,"sprint":null,"race":null}]},
{"key":15,"meetings":[{"year":2020,"gp":"Spanish Grand Prix","date":"2020-08-16","laps":66,"sprint":null,"race":null}]},
{"key":19,"meetings":[{"year":2020,"gp":"Austrian Grand Prix","date":"2020-07-05","laps":71,"sprint":null,"race":null},{"year":2020,"gp":"Styrian Grand Prix","date":"2020-07-12","laps":71,"sprint":null,"race":null}]},
{"key":39,"meetings":[{"year":2020,"gp":"Italian Grand Prix","date":"2020-09-06","laps":53,"sprint":null,"race":null}]},
{"key":63,"meetings":[{"year":2020,"gp":"Bahrain Grand Prix","date":"2020-11-29","laps":57,"sprint":null,"race":null},{"year":2020,"gp":"Sakhir Grand Prix","date":"2020-12-06","laps":57,"sprint":null,"race":null,"distanceKm":308,"note":"raced on the Outer circuit (87 laps of 3.5 km) – here on the Grand Prix layout, same distance (57 laps)"}]},
{"key":70,"meetings":[{"year":2020,"gp":"Abu Dhabi Grand Prix","date":"2020-12-13","laps":55,"sprint":null,"race":null}]},
{"key":"mugello","name":"Mugello","country":"Italy","location":"Mugello","meetings":[{"year":2020,"gp":"Tuscan Grand Prix","date":"2020-09-13","laps":59,"sprint":null,"race":null}],"character":{"short":"Mugello","power":0.7,"downforce":0.8,"tyres":0.9,"overtaking":0.3,"street":0,"rain":0.15,"air":27,"wind":0.3},"layout":"data/tracks/mugello.js"},
{"key":"sochi","name":"Sochi","country":"Russia","location":"Sochi","meetings":[{"year":2020,"gp":"Russian Grand Prix","date":"2020-09-27","laps":53,"sprint":null,"race":null}],"character":{"short":"Sochi","power":0.75,"downforce":0.5,"tyres":0.3,"overtaking":0.5,"street":0.5,"rain":0.2,"air":22,"wind":0.3},"layout":"data/tracks/sochi.js"},
{"key":"nurburgring","name":"Nürburgring","country":"Germany","location":"Nürburg","meetings":[{"year":2020,"gp":"Eifel Grand Prix","date":"2020-10-11","laps":60,"sprint":null,"race":null}],"character":{"short":"Nürburgring","power":0.6,"downforce":0.6,"tyres":0.5,"overtaking":0.5,"street":0,"rain":0.45,"air":11,"wind":0.4},"layout":"data/tracks/nurburgring.js"},
{"key":"portimao","name":"Portimão","country":"Portugal","location":"Portimão","meetings":[{"year":2020,"gp":"Portuguese Grand Prix","date":"2020-10-25","laps":66,"sprint":null,"race":null}],"character":{"short":"Portimão","power":0.6,"downforce":0.7,"tyres":0.6,"overtaking":0.4,"street":0,"rain":0.1,"air":20,"wind":0.7},"layout":"data/tracks/portimao.js"},
{"key":"istanbul","name":"Istanbul","country":"Turkey","location":"Istanbul","meetings":[{"year":2020,"gp":"Turkish Grand Prix","date":"2020-11-15","laps":58,"sprint":null,"race":null}],"character":{"short":"Istanbul","power":0.7,"downforce":0.7,"tyres":0.6,"overtaking":0.6,"street":0,"rain":0.25,"air":15,"wind":0.5},"layout":"data/tracks/istanbul.js"}
],
"teams": [
{"id":"mercedes","years":{"2020":{"name":"Mercedes","colour":"#00D2BE","drivers":["BOT","HAM","RUS"],"avgFinish":3.3,"engine":"Mercedes"}}},
{"id":"ferrari","years":{"2020":{"name":"Ferrari","colour":"#DC0000","drivers":["LEC","VET"],"avgFinish":8.8,"engine":"Ferrari"}}},
{"id":"mclaren","years":{"2020":{"name":"McLaren","colour":"#FF8700","drivers":["NOR","SAI"],"avgFinish":7.3,"engine":"Renault"}}},
{"id":"astonmartin","years":{"2020":{"name":"Racing Point","colour":"#F596C8","drivers":["STR","PER","HUL"],"avgFinish":6.3,"engine":"Mercedes"}}},
{"id":"racingbulls","years":{"2020":{"name":"AlphaTauri","colour":"#2B4562","drivers":["GAS","KVY"],"avgFinish":9.4,"engine":"Honda"}}},
{"id":"alpine","years":{"2020":{"name":"Renault","colour":"#FFF500","drivers":["OCO","RIC"],"avgFinish":7.4,"engine":"Renault"}}},
{"id":"sauber","years":{"2020":{"name":"Alfa Romeo","colour":"#9B0000","drivers":["GIO","RAI"],"avgFinish":13.4,"engine":"Ferrari"}}},
{"id":"williams","years":{"2020":{"name":"Williams","colour":"#0082FA","drivers":["LAT","RUS","AIT"],"avgFinish":15.3,"engine":"Mercedes"}}},
{"id":"redbull","years":{"2020":{"name":"Red Bull","colour":"#1E41FF","drivers":["ALB","VER"],"avgFinish":5.2,"engine":"Honda"}}},
{"id":"haas","years":{"2020":{"name":"Haas F1 Team","colour":"#B6BABD","drivers":["MAG","GRO","FIT"],"avgFinish":14.9,"engine":"Ferrari"}}}
],
"drivers": [
{"id":"BOT","first":"Valtteri","last":"Bottas","country":"FIN","seasons":{"2020":{"number":77,"races":17,"dnf":1,"points":221,"h2hQ":[6,17],"h2hR":[5,17],"team":"mercedes","avgFinish":4.3,"avgQuali":2.3}}},
{"id":"LEC","first":"Charles","last":"Leclerc","country":"MON","seasons":{"2020":{"number":16,"races":17,"dnf":4,"points":98,"h2hQ":[13,17],"h2hR":[10,15],"team":"ferrari","avgFinish":7,"avgQuali":8.3}}},
{"id":"NOR","first":"Lando","last":"Norris","country":"GBR","seasons":{"2020":{"number":4,"races":17,"dnf":1,"points":95,"h2hQ":[9,17],"h2hR":[9,17],"team":"mclaren","avgFinish":7.8,"avgQuali":8.2}}},
{"id":"HAM","first":"Lewis","last":"Hamilton","country":"GBR","seasons":{"2020":{"number":44,"races":16,"dnf":0,"points":341,"h2hQ":[11,16],"h2hR":[12,16],"team":"mercedes","avgFinish":1.9,"avgQuali":1.7}}},
{"id":"SAI","first":"Carlos","last":"Sainz","country":"ESP","seasons":{"2020":{"number":55,"races":17,"dnf":3,"points":104,"h2hQ":[8,17],"h2hR":[8,17],"team":"mclaren","avgFinish":6.8,"avgQuali":8.3}}},
{"id":"PER","first":"Sergio","last":"Pérez","country":"MEX","seasons":{"2020":{"number":11,"races":15,"dnf":2,"points":125,"h2hQ":[11,15],"h2hR":[9,14],"team":"astonmartin","avgFinish":5.6,"avgQuali":7.1}}},
{"id":"GAS","first":"Pierre","last":"Gasly","country":"FRA","seasons":{"2020":{"number":10,"races":17,"dnf":3,"points":75,"h2hQ":[13,17],"h2hR":[9,17],"team":"racingbulls","avgFinish":8.3,"avgQuali":10.1}}},
{"id":"OCO","first":"Esteban","last":"Ocon","country":"FRA","seasons":{"2020":{"number":31,"races":17,"dnf":4,"points":62,"h2hQ":[2,17],"h2hR":[4,17],"team":"alpine","avgFinish":8.3,"avgQuali":9.9}}},
{"id":"GIO","first":"Antonio","last":"Giovinazzi","country":"ITA","seasons":{"2020":{"number":99,"races":17,"dnf":3,"points":4,"h2hQ":[9,17],"h2hR":[5,17],"team":"sauber","avgFinish":13.9,"avgQuali":16.9}}},
{"id":"VET","first":"Sebastian","last":"Vettel","country":"GER","seasons":{"2020":{"number":5,"races":17,"dnf":2,"points":33,"h2hQ":[4,17],"h2hR":[5,15],"team":"ferrari","avgFinish":10.4,"avgQuali":12.2}}},
{"id":"LAT","first":"Nicholas","last":"Latifi","country":"CAN","seasons":{"2020":{"number":6,"races":17,"dnf":3,"points":0,"h2hQ":[1,17],"h2hR":[6,17],"team":"williams","avgFinish":15.4,"avgQuali":18.9}}},
{"id":"KVY","first":"Daniil","last":"Kvyat","country":"RUS","seasons":{"2020":{"number":26,"races":17,"dnf":2,"points":32,"h2hQ":[4,17],"h2hR":[8,17],"team":"racingbulls","avgFinish":10.5,"avgQuali":12.1}}},
{"id":"ALB","first":"Alexander","last":"Albon","country":"THA","seasons":{"2020":{"number":23,"races":17,"dnf":2,"points":105,"h2hQ":[0,17],"h2hR":[4,16],"team":"redbull","avgFinish":7.4,"avgQuali":7.2}}},
{"id":"RAI","first":"Kimi","last":"Räikkönen","country":"FIN","seasons":{"2020":{"number":7,"races":17,"dnf":1,"points":4,"h2hQ":[8,17],"h2hR":[12,17],"team":"sauber","avgFinish":13,"avgQuali":16.6}}},
{"id":"RUS","first":"George","last":"Russell","country":"GBR","seasons":{"2020":{"number":63,"races":17,"dnf":4,"points":2,"h2hQ":[16,17],"h2hR":[10,17],"team":"williams","avgFinish":14.6,"avgQuali":14.8}}},
{"id":"GRO","first":"Romain","last":"Grosjean","country":"FRA","seasons":{"2020":{"number":8,"races":15,"dnf":3,"points":2,"h2hQ":[7,15],"h2hR":[7,13],"team":"haas","avgFinish":14.7,"avgQuali":17}}},
{"id":"MAG","first":"Kevin","last":"Magnussen","country":"DEN","seasons":{"2020":{"number":20,"races":17,"dnf":7,"points":1,"h2hQ":[10,17],"h2hR":[8,15],"team":"haas","avgFinish":14.5,"avgQuali":16.9}}},
{"id":"STR","first":"Lance","last":"Stroll","country":"CAN","seasons":{"2020":{"number":18,"races":16,"dnf":5,"points":75,"h2hQ":[5,16],"h2hR":[7,15],"team":"astonmartin","avgFinish":7,"avgQuali":8.6}}},
{"id":"RIC","first":"Daniel","last":"Ricciardo","country":"AUS","seasons":{"2020":{"number":3,"races":17,"dnf":1,"points":117,"h2hQ":[15,17],"h2hR":[13,17],"team":"alpine","avgFinish":6.8,"avgQuali":7.7}}},
{"id":"VER","first":"Max","last":"Verstappen","country":"NED","seasons":{"2020":{"number":33,"races":17,"dnf":5,"points":211,"h2hQ":[17,17],"h2hR":[12,16],"team":"redbull","avgFinish":2.4,"avgQuali":3.1}}},
{"id":"HUL","first":"Nico","last":"Hülkenberg","country":"GER","seasons":{"2020":{"number":27,"races":3,"dnf":1,"points":10,"h2hQ":[1,3],"h2hR":[0,3],"team":"astonmartin","avgFinish":7.5,"avgQuali":12}}},
{"id":"AIT","first":"Jack","last":"Aitken","country":"GBR","seasons":{"2020":{"number":89,"races":1,"dnf":0,"points":0,"h2hQ":[0,1],"h2hR":[1,1],"team":"williams","avgFinish":16,"avgQuali":18}}},
{"id":"FIT","first":"Pietro","last":"Fittipaldi","country":"BRA","seasons":{"2020":{"number":51,"races":2,"dnf":0,"points":0,"h2hQ":[0,2],"h2hR":[0,2],"team":"haas","avgFinish":18,"avgQuali":19.5}}}
]
}, { builtIn: true });
