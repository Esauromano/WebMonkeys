module.exports = function WebMonkeys(opt){
  var maxMonkeys,
    resultTextureSide,
    arrays,
    arrayByName,
    shaderByTask,
    monkeyIndexArray,
    gl,
    defaultLib,
    writer,
    renderer,
    resultTexture,
    userLib,
    framebuffer,
    rangeBuffer,
    rendererVertexBuffer;

  // () -> *{Monkeys}
  function init(){
    opt = opt || [];
    maxMonkeys = opt.maxMonkeys || 2048*2048;
    resultTextureSide = opt.resultTextureSide || 2048;
    arrays = [];
    arrayByName = {};
    shaderByTask = {};
    monkeyIndexArray = [];

    var glOpt = {antialias: false, preserveDrawingBuffer: true};
    if (typeof window === "undefined"){
      gl = require("gl")(1, 1, glOpt);
    } else {
      var canvas = document.createElement("canvas");
      gl = canvas.getContext("webgl", glOpt);
      gl.canvas = canvas;
      gl.canvas.width = 1;
      gl.canvas.height = 1;
      gl.canvas.style = [
        "border: 1px solid black;",
        "image-rendering: optimizeSpeed;",
        "image-rendering: -moz-crisp-edges;",
        "image-rendering: -webkit-optimize-contrast;",
        "image-rendering: -o-crisp-edges;",
        "image-rendering: pixelated;",
        "-ms-interpolation-mode: nearest-neighbor;"].join("");
    }

    // FIXME: this causes a small slowdown on startup; a better behavior
    // would be to dynamically alloc a bigger buffer on demand
    for (var i=0; i<maxMonkeys; ++i)
      monkeyIndexArray[i] = i; 

    defaultLib = [
      "vec2 indexToPos(vec2 size, float index){",
      "  return vec2(mod(index, size.x), floor(index/size.x));",
      "}",
      "float posToIndex(vec2 size, vec2 pos){",
      "  return pos.y*size.x + pos.x;",
      "}",
      "vec2 scaleRange(vec2 fromA, vec2 fromB, vec2 toA, vec2 toB, vec2 pos){",
      "  return toA+(pos-fromA)/(fromB-fromA)*(toB-toA);",
      "}",
      "vec4 packFloat(float x){",
      "  float s = x > 0.0 ? 1.0 : -1.0;",
      "  float e = floor(log2(s*x));",
      "  float m = s*x / pow(2.0, e);",
      "  return vec4(",
      "    floor(fract((m-1.0)*256.0*256.0)*256.0),",
      "    floor(fract((m-1.0)*256.0)*256.0),",
      "    floor(fract((m-1.0)*1.0)*256.0),",
      "    ((e+63.0) + (x>0.0?128.0:0.0)))/255.0;",
      "}",
      "float unpackFloat(vec4 v){",
      "  v *= 255.0;",
      "  float s = v.a >= 128.0 ? 1.0 : -1.0;",
      "  float e = v.a - (v.a >= 128.0 ? 128.0 : 0.0) - 63.0;",
      "  float m = 1.0 + v.x/256.0/256.0/256.0 + v.y/256.0/256.0 + v.z/256.0;",
      "  return s * pow(2.0, e) * m;",
      "}",
      "vec4 packVec4(vec4 v){",
      "  return v/255.0;",
      "}",
      "vec4 unpackVec4(vec4 v){",
      "  return v*255.0;",
      "}",
      "vec4 packIndexDepth(int a, int b){",
      "  float av = float(a);",
      "  float bv = float(b);",
      "  float x = mod(floor(av), 256.0);",
      "  float y = mod(floor(av/256.0), 256.0);",
      "  float z = mod(floor(av/256.0/256.0), 256.0);",
      "  float w = mod(floor(bv), 256.0);",
      "  return vec4(x,y,z,w)/255.0;",
      "}",
      "int unpackIndex(vec4 v){",
      "  return int(v.x*255.0 + v.y*255.0*256.0 + v.z*255.0*256.0*256.0);",
      "}",
      "int unpackDepth(vec4 v){",
      "  return int(v.w*255.0);",
      "}",
      ].join("\n");

    writer = buildShader(
      ["precision highp float;",
      "attribute float resultIndex;",
      "uniform sampler2D resultTexture;",
      "uniform float resultTextureSide;",
      "uniform float resultGridSide;",
      "uniform float resultSquareSide;",
      "uniform float targetTextureSide;",
      "varying vec4 value;",
      defaultLib,
      "void main(){",
      "  float resultSquareIndex = mod(resultIndex, resultSquareSide*resultSquareSide/2.0);", 
      "  vec2 resultSquareCoord = indexToPos(vec2(resultSquareSide/2.0,resultSquareSide), resultSquareIndex)*vec2(2.0,1.0);",
      "  vec2 resultGridCoord = indexToPos(vec2(resultGridSide), floor(resultIndex/(resultSquareSide*resultSquareSide/2.0)));",
      "  vec2 resultCoord = resultGridCoord * resultSquareSide + resultSquareCoord;",
      "  vec2 indexCoord = (resultCoord+vec2(0.5,0.5))/resultTextureSide;",
      "  vec2 valueCoord = (resultCoord+vec2(1.5,0.5))/resultTextureSide;",
      "  float index = float(unpackIndex(texture2D(resultTexture, indexCoord))-1);",
      "  float depth = float(unpackDepth(texture2D(resultTexture, indexCoord)));",
      "  value = texture2D(resultTexture, valueCoord);",
      "  vec2 rPos = (indexToPos(vec2(targetTextureSide),index)+vec2(0.5))/targetTextureSide*2.0-1.0;",
      "  gl_Position = vec4(depth > 0.5 ? rPos : vec2(-1.0,-1.0), (255.0-depth)/255.0, 1.0);",
      //"  gl_Position = vec4(rPos, -0.5, 1.0);",
      "  gl_PointSize = 1.0;",
      "}"].join("\n"),
      ["precision highp float;",
      "varying vec4 value;",
      "void main(){",
      "  gl_FragColor = value;",
      "}"].join("\n"));

    renderer = buildShader(
      ["precision highp float;",
      "attribute vec2 vertexPos;",
      "varying vec2 pos;",
      "void main(){",
      "  pos = vertexPos;",
      "  gl_Position = vec4(vertexPos, 0.0, 1.0);",
      "}"].join("\n"),
      ["precision mediump float;",
      "uniform sampler2D array;",
      "varying vec2 pos;",
      "void main(){",
      "  gl_FragColor = texture2D(array, pos*0.5+0.5);",
      //"  gl_FragColor = vec4(1.0, 0.5, 0.5, 1.0);",
      "}"].join("\n"));

    gl.clearDepth(256.0);

    rendererVertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, rendererVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([1,1,-1,-1,1,-1,1,1,-1,1,-1,-1]), gl.STATIC_DRAW);

    rangeBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, rangeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(monkeyIndexArray), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    resultTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, resultTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, resultTextureSide, resultTextureSide, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

    return monkeysApi;
  };

  // *{Monkeys}, String, String -> WebGLProgram
  function buildShader(vertexSrc, fragmentSrc){
    function compile(type, shaderSource){
      var shader = gl.createShader(type);
      gl.shaderSource(shader, shaderSource);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)){
        var errorMsg = "WebMonkeys had the following error from WebGL: " + gl.getShaderInfoLog(shader);
        if (errorMsg.indexOf("syntax error") !== -1)
          errorMsg += "This could mean that you forgot to add a `;` before the list of setters.";
        throw errorMsg;
      }
      return shader;
    }
    var vertexShader = compile(gl.VERTEX_SHADER, vertexSrc);
    var fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentSrc);

    var shader = gl.createProgram();
    gl.attachShader(shader, vertexShader);
    gl.attachShader(shader, fragmentShader);
    gl.linkProgram(shader);
    if(!gl.getProgramParameter(shader, gl.LINK_STATUS))
      throw "Error linking shaders.";

    return shader;
  }

  // Number -> Number
  function fitTextureSide(elements){
    return Math.pow(2, Math.ceil(Math.log(Math.sqrt(elements))/Math.log(2)));
  };

  // Number -> Number
  function fract(x){ 
    return x - Math.floor(x);
  };

  // *{Monkeys}, String -> Either (Array Number) Uint32Array
  function get(name){
    var array = arrayByName[name];
    var targetArray = array.uint32Array;
    var pixels = targetArray
      ? new Uint8Array(targetArray.buffer)  // re-uses existing buffer
      : new Uint8Array(array.textureSide*array.textureSide*4);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, array.texture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
    gl.readPixels(0, 0, array.textureSide, array.textureSide, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    if (!targetArray){
      var result = [];
      for (var i=0, l=array.length; i<l; ++i){
        var s = pixels[i*4+3] >= 128 ? 1 : -1;
        var e = pixels[i*4+3] - (pixels[i*4+3] >= 128 ? 128 : 0) - 63;
        var m = 1 + pixels[i*4+0]/256/256/256 + pixels[i*4+1]/256/256 + pixels[i*4+2]/256;
        var n = s * Math.pow(2, e) * m;
        var z = 0.000000000000000001; // to avoid annoying floating point error for 0
        result.push(-z < n && n < z ? 0 : n);
      };
      return result;
    } else {
      return targetArray;
    }
  };

  // *{Monkeys}, String, Uint32Array -> Monkeys
  // *{Monkeys}, String, Array Number -> Monkeys
  // *{Monkeys}, String, Number -> Monkeys
  function set(name, lengthOrArray){
    if (typeof lengthOrArray === "number"){
      var length = lengthOrArray;
      var textureSide = fitTextureSide(length);
      var array = null;
    } else {
      var length = lengthOrArray.length;
      var textureSide = fitTextureSide(length);
      if (lengthOrArray instanceof Array) { // upload JS Numbers as Floats
        var array = new Uint8Array(textureSide*textureSide*4);
        for (var i=0, l=lengthOrArray.length; i<l; ++i){ 
          var x = lengthOrArray[i];
          var s = x > 0 ? 1 : -1;
          var e = Math.floor(Math.log2(s*x));
          var m = s*x/Math.pow(2, e);
          array[i*4+0] = Math.floor(fract((m-1)*256*256)*256)||0;
          array[i*4+1] = Math.floor(fract((m-1)*256)*256)||0;
          array[i*4+2] = Math.floor(fract((m-1)*1)*256)||0;
          array[i*4+3] = ((e+63) + (x>0?128:0))||0;
        };
      } else { // upload 32-bit Uints as Vec4s
        if (textureSide * textureSide !== length)
          throw "WebMonkey error: when on raw buffer mode, the length of your\n"
              + "buffer must be (2^n)^2 for a positive integer n. That is, it\n"
              + "could be 1, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144\n"
              + "and so on. Your '"+name+"' buffer has length "+length+".";
        var array = new Uint8Array(lengthOrArray.buffer);
      }
    }
    gl.activeTexture(gl.TEXTURE0);
    if (!arrayByName[name]){
      var texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, textureSide, textureSide, 0, gl.RGBA, gl.UNSIGNED_BYTE, array);
      var depthbuffer = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depthbuffer);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, textureSide, textureSide);
      arrayByName[name] = {
        name: name,
        uint32Array: lengthOrArray instanceof Uint32Array ? lengthOrArray : null,
        valueType: lengthOrArray instanceof Uint32Array ? "vec4" : "float",
        texture: texture,
        depthbuffer: depthbuffer,
        textureName: name+"_",
        textureSide: textureSide,
        length: length};
      arrays.push(arrayByName[name]);
    } else {
      var texture = arrayByName[name].texture;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, textureSide, textureSide, 0, gl.RGBA, gl.UNSIGNED_BYTE, array);
    }
    return monkeysApi;
  };

  // *{Monkeys}, String -> Monkeys
  function del(name){
    var existingArray;
    if (existingArray = arraysByName[name]){
      delete arraysByName[name];
      arrays = arrays.filter(function(arr){
        return arr !== existingArray;
      });
      gl.deleteTexture(existingArray.texture);
    };
    return monkeysApi;
  };

  // Parses a setter statement such as:
  //   foo(i*8) := bar(i*8) + baz(i*8);
  // And returns `name`, `index` and `value` strings:
  //   {name: "foo", index: "i*8", depth: "", value: "bar[i*8] + baz[i*8]"}
  // String -> Maybe {name: String, index: String, value: String}
  function parseSetterStatement(statement){
    var name = "";
    var index = "";
    var depth = "";
    var value = "";
    var phase = 0;
    var brackets = 1;
    for (var i=0, l=statement.length; i < l; ++i){
      var chr = statement[i];
      switch (phase){
        case 0: 
          if (chr === "(")
            phase = 1;
          else if (chr !== " " && chr !== "\n")
            name += chr;
        break;
        case 1:
          if (chr === "(")
            ++brackets;
          else if (chr === ")")
            --brackets;
          if (brackets === 1 && chr === ",")
            phase = 2;
          else if (brackets === 0)
            phase = 3;
          else
            index += chr;
        break;
        case 2:
          if (chr === "(")
            ++brackets;
          else if (chr === ")")
            --brackets;
          if (brackets === 0)
            phase = 3;
          else
            depth += chr;
        break;
        case 3:
          if (chr === ":")
            phase = 4;
        break;
        case 4:
          if (chr === "=")
            phase = 5;
          else
            return null;
        break;
        case 5:
          if (chr !== " ")
            value += chr,
            phase = 6;
          break;
        case 6:
          if (chr === ";")
            phase = 7;
          else
            value += chr;
        break;
      };
    };
    return phase === 7 
      ? {name: name,
        index: index,
        depth: depth,
        value: value}
      : null;
  };

  // Int, String -> {shader: GLShader, maxResults: Uint, resultArrayName: String, usesDepth: bool}
  function buildShaderForTask(task){
    if (shaderByTask[task]) 
      return shaderByTask[task];

    var usesDepth = false;
    var taskStatements = task.split(";");
    taskStatements.pop();
    var setters = [];
    var setter;
    while (setter = parseSetterStatement(taskStatements[taskStatements.length-1]+";")){
      setters.push(setter);
      taskStatements.pop();
      if (setter.depth !== "0")
        usesDepth = true;
    };
    if (setters.length === 0)
      throw "Error parsing Monkey task: tasks must end with a setter statement such as `foo[0] = 0;`.";
    var resultArrayName = setters[0].name;
    for (var i=1, l=setters.length; i<l; ++i)
      if (setters[i].name !== resultArrayName)
        throw "Error parsing Monkey task: you can't write to different arrays on the same task.";

    var taskWithoutSetters = taskStatements.join(";")+";";

    var usedResults = setters.length;
    var maxResults = Math.pow(fitTextureSide(usedResults*2),2)/2;

    var getters = "";
    for (var i=0, l=arrays.length; i<l; ++i)
      getters 
        += "uniform sampler2D "+arrays[i].textureName+";\n"
        +  arrays[i].valueType+" "+arrays[i].name+"(float idx){\n"
        +  "  return "+(arrays[i].valueType==="float"?"unpackFloat":"unpackVec4")+"(texture2D("+arrays[i].textureName+",indexToPos(vec2("+arrays[i].textureSide.toFixed(1)+"), idx)/"+arrays[i].textureSide.toFixed(2)+"));\n"
        +  "}\n"
        +  arrays[i].valueType+" "+arrays[i].name+"(int idx){\n"
        +  "  return "+arrays[i].name+"(float(idx));\n"
        +  "}\n";

    var setterFns = "";
    for (var i=0; i<maxResults; ++i){
      setterFns += "void set"+i+"(int i"+i+", int d"+i+", float v"+i+"){\n";
      setterFns += "  results["+(i*2+0)+"] = packIndexDepth(i"+i+"+1, d"+i+");\n"
      setterFns += "  results["+(i*2+1)+"] = packFloat(v"+i+");\n"
      setterFns += "}\n";
      setterFns += "void set"+i+"(int i"+i+", int d"+i+", vec4 v"+i+"){\n";
      setterFns += "  results["+(i*2+0)+"] = packIndexDepth(i"+i+"+1, d"+i+");\n"
      setterFns += "  results["+(i*2+1)+"] = packVec4(v"+i+");\n"
      setterFns += "}\n";
    };

    var writeToTexture = "";
    for (var i=0; i<maxResults*2; ++i)
      writeToTexture += "  if (idx == "+i+") gl_FragColor = results["+i+"];\n";

    var setter = "";
    for (var i=0; i < maxResults; ++i){
      setter += "  set"+i+"(";
      setter += i < usedResults
        ? setters[i].index+", "
          + (setters[i].depth||"1")+", "
          + setters[i].value
        : "0, 0, vec4(0.0)";
      setter += ");\n";
    };

    var vertexShader = [
      "precision highp float;",
      "uniform float resultTextureSide;",
      "uniform float resultGridSide;",
      "uniform float resultSquareSide;",
      "attribute float resultIndex;",
      "varying float resultIndexVar;",
      "varying vec4 results["+(maxResults*2)+"];",
      defaultLib,
      getters,
      setterFns,
      userLib,
      "vec4 scaleToScreen(vec2 pos){",
      "  vec2 screenCoord = scaleRange(vec2(0.0,0.0), vec2(resultGridSide), vec2(-1.0), vec2(-1.0+resultSquareSide*resultGridSide/resultTextureSide*2.0), pos);",
      "  return vec4(screenCoord + vec2(resultSquareSide)/resultTextureSide, 1.0, 1.0);",
      "}",
      "void main(){",
      "  int i = int(resultIndex);",
      "  float f = resultIndex;",
      taskWithoutSetters,
      setter,
      "  gl_PointSize = resultSquareSide;",
      "  gl_Position = scaleToScreen(indexToPos(vec2(resultGridSide), resultIndex));",
      "  resultIndexVar = resultIndex;",
      "}"].join("\n")

    var fragmentShader = [
      "precision highp float;",
      "varying float resultIndexVar;",
      "varying vec4 results["+(maxResults*2)+"];",
      "uniform float resultSquareSide;",
      defaultLib,
      "void main(){",
      "  vec2 coord = floor(gl_PointCoord * resultSquareSide);",
      "  int idx = int((resultSquareSide-1.0-coord.y) * resultSquareSide + coord.x);",
      writeToTexture,
      "}"].join("\n");
      
      var shader = buildShader(vertexShader, fragmentShader);

      return shaderByTask[task] = {
        usesDepth: usesDepth,
        fragmentShader: fragmentShader,
        vertexShader: vertexShader,
        shader: shader,
        maxResults: maxResults,
        resultArrayName: resultArrayName};
  };

  // *{Monkeys}, Number, String -> Monkeys
  function work(monkeyCount, task){
    var shaderObject = buildShaderForTask(task);
    var shader = shaderObject.shader;
    var maxResults = shaderObject.maxResults;
    var resultArrayName = shaderObject.resultArrayName;
    var usesDepth = shaderObject.usesDepth;

    var output = arrayByName[resultArrayName];

    var resultSquareSide = fitTextureSide(maxResults*2);
    var resultGridSide = fitTextureSide(monkeyCount);
    var usedResultTextureSide = resultGridSide * resultSquareSide;

    gl.useProgram(shader);
    gl.bindBuffer(gl.ARRAY_BUFFER, rangeBuffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.uniform1f(gl.getUniformLocation(shader,"resultGridSide"), resultGridSide);
    gl.uniform1f(gl.getUniformLocation(shader,"resultSquareSide"), resultSquareSide);
    gl.uniform1f(gl.getUniformLocation(shader,"resultTextureSide"), resultTextureSide);
    gl.vertexAttribPointer(gl.getAttribLocation(shader,"resultIndex"), 1, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(gl.getAttribLocation(shader,"resultIndex"));
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, resultTexture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
    gl.viewport(0, 0, resultTextureSide, resultTextureSide);
    for (var i=0, l=arrays.length; i<l; ++i){
      gl.activeTexture(gl.TEXTURE0+i);
      gl.bindTexture(gl.TEXTURE_2D, arrays[i].texture);
      gl.uniform1i(gl.getUniformLocation(shader,arrays[i].textureName), i);
    }
    gl.drawArrays(gl.POINTS, 0, monkeyCount);

    if (usesDepth) gl.enable(gl.DEPTH_TEST);
    gl.useProgram(writer);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, resultTexture);
    gl.uniform1i(gl.getUniformLocation(writer,"resultTexture"), resultTexture);
    gl.uniform1f(gl.getUniformLocation(writer,"resultGridSide"), resultGridSide);
    gl.uniform1f(gl.getUniformLocation(writer,"resultSquareSide"), resultSquareSide);
    gl.uniform1f(gl.getUniformLocation(writer,"resultTextureSide"), resultTextureSide);
    gl.uniform1f(gl.getUniformLocation(writer,"targetTextureSide"), output.textureSide);
    gl.vertexAttribPointer(gl.getAttribLocation(writer,"resultIndex"), 1, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(gl.getAttribLocation(writer,"resultIndex"));
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output.texture, 0);
    gl.viewport(0, 0, output.textureSide, output.textureSide);
    if (usesDepth){
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, output.depthbuffer);
      gl.clear(gl.DEPTH_BUFFER_BIT)
    };
    gl.drawArrays(gl.POINTS, 0, monkeyCount*resultSquareSide*resultSquareSide/2);
    if (usesDepth) gl.disable(gl.DEPTH_TEST);
  };

  // Allows rendering arrays to a Canvas for visualization
  // *{Monkeys}, String, Number, Number -> Canvas
  function render(name, width, height){
    if (gl.canvas && arrayByName[name]){
      gl.canvas.width = width;
      gl.canvas.height = height;
      gl.useProgram(renderer);
      gl.viewport(0, 0, width, height);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, arrayByName[name].texture);

      gl.bindBuffer(gl.ARRAY_BUFFER, rendererVertexBuffer);
      var vertexPosAttr = gl.getAttribLocation(renderer, "vertexPos")
      gl.vertexAttribPointer(vertexPosAttr, 2, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(vertexPosAttr);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      return gl.canvas;
    }
    return null;
  };

  // *{Monkeys}, String -> Monkeys
  function lib(source){
    userLib = source;
    return monkeysApi;
  };

  // *{Monkeys}, String -> String
  function stringify(name){
    return JSON.stringify(get(name));
  };

  // *{Monkeys}, String -> IO ()
  function log(name){
    console.log(stringify(name))
  };

  var monkeysApi = {
    set: set,
    get: get,
    del: del,
    lib: lib,
    work: work,
    render: render,
    stringify: stringify,
    log: log
  };

  return init();
};
