import { useState, useEffect } from 'preact/hooks'
import { Fragment } from 'preact'
import distance from 'euclidean-distance'
import { intersect } from 'line-intersect-2d'
import pointOnLine from 'point-on-line'
import svgIntersections from 'svg-intersections'
import midPoint from 'midpoint'

function getStageMetrics() {
  return {
    h: window.innerHeight,
    w: window.innerWidth,
  }
}

class Plaza {
  constructor(props) {
    this.type = 'plaza'
    this.cx = this.snapToGrid(props.x)
    this.cy = this.snapToGrid(props.y)
    this.r = 5
    this.lines = []
  }
  snapToGrid(n) {
    return Math.ceil(n / 10) * 10 - 5;
  }
  background() {
    return <circle { ...this } />
  }
  foreground(preview) {
    return <circle
      { ...this }
      r={this.r - 1}
      fill={ preview ? "skyBlue" : "white" }
    />
  }
  preview() {
    return this.foreground(true)
  }
}

class Course {
  constructor(props, context, draw = false) {
    this.type = 'course'
    this.width = 5

    this.c = {
      x: props.x,
      y: props.y,
    }

    this.context = context
    this.closestPlaza = this.closestPlazas()[0].feature
    this.end = {
      x: this.closestPlaza.cx,
      y: this.closestPlaza.cy
    }

    const ΔX = props.x - this.closestPlaza.cx
    const ΔY = props.y - this.closestPlaza.cy
    const rad = Math.atan2(ΔX,ΔY)
    const maxLength = 1000

    const secondPlaza = this.closestPlazas()[1].feature

    const guideΔX = secondPlaza.cx - this.closestPlaza.cx
    const guideΔY = secondPlaza.cy - this.closestPlaza.cy
    this.snapAngle = Math.atan2(guideΔX,guideΔY)
    
    const angle = this.snapToAngle(rad)

    this.dest = {
      x: Math.sin(angle) * maxLength + this.closestPlaza.cx,
      y: Math.cos(angle) * maxLength + this.closestPlaza.cy,
    }

    this.generateIntersections()
    this.generateLineSegments()
    if (this.segments.length > 0) {
      this.start = this.segments[0].start
      this.end = this.segments[0].end
    } else {
      this.start = this.dest
    }
    if (draw) {
      this.closestPlaza.lines.push(this)
      this.angle = angle - this.snapAngle
      if (this.segments.length > 0 && (this.segments[0].feature !== null && this.segments[0].feature.type == 'plaza')) {
        this.segments[0].feature.lines.push(this)
      }
    }
  }
  getPossibleAngles(divisors) {
    const full = Math.PI * 2
    const segment = full / Math.min(divisors, 4096)

    const possibleAngles = []
    for (let i = 0; i < full; i = i + segment) {
      const angle = i + this.snapAngle + Math.PI
      if (angle > full) {
        possibleAngles.push(angle - full)
      } else if (angle < 0) {
        possibleAngles.push(angle + full)
      } else {
        possibleAngles.push(angle)
      }
    }
    return possibleAngles;
  }
  minAngle(angles) {
    angles = angles.filter((c, index) => {
      return angles.indexOf(c) === index;
    });
    let diff = Math.PI * 2
       
    for (let i=0; i<angles.length-1; i++) {
      for (let j=i+1; j<angles.length; j++) {
        const abs = Math.abs((angles[i] - angles[j]))
        if (abs < diff && abs > 0) {
          diff = Math.abs((angles[i] - angles[j]));
        }
      }
    }
    return diff
  } 
  snapToAngle(n) {
    const existingLines = this.closestPlaza.lines;

    const possibleAngles = []
    if (existingLines.length == 0 || existingLines.length == 1) {
      possibleAngles.push(
        ...this.getPossibleAngles(4),
        ...this.getPossibleAngles(3)
      )
    } else if (existingLines.length > 1) {
      const angles = existingLines.map((x) => Math.abs(x.angle))
      const smolestAngle = this.minAngle(angles)
      const half = Math.round((Math.PI * 2) / (smolestAngle / 2))

      possibleAngles.push(
        ...this.getPossibleAngles(half)
      )
    }

    const goal = n + Math.PI
    const closestPossibleAngle = possibleAngles.reduce(function(prev, curr) {
      return (Math.abs(curr - goal) < Math.abs(prev - goal) ? curr : prev)
    })

    //console.debug(`closestPossibleAngle ${closestPossibleAngle * (180/Math.PI)}`)

    return closestPossibleAngle - Math.PI

  }
  closestPlazas() {
    const featureDist = []
    for (const feature of this.context) {
      if (feature.type == 'plaza') {
        featureDist.push({
          feature: feature,
          dist: distance([this.c.x, this.c.y], [feature.cx, feature.cy])
        })
      }
    }
    const closest = featureDist.sort((A, B) => {
      return A.dist < B.dist ? -1 : 1;
    });
    return closest;
  }
  generateLineSegments() {
    const segments = []
    let lastPoint = this.end
    for (const intersection of this.intersections) {
      const start = lastPoint
      const end = intersection.point
      const midpoint = midPoint([[start.x, start.y], [end.x, end.y]])
      segments.push({
        feature: intersection.feature,
        start: start,
        end: end,
        dist: distance(midpoint, [this.c.x, this.c.y])
      })
      lastPoint = intersection.point
    }

    segments.push({
      feature: null,
      start: lastPoint,
      end: this.dest,
      dist: distance([ lastPoint.x, lastPoint.y ], [this.c.x, this.c.y])
    })


    const closest = segments.sort(this.sortByDistance)
    this.segments = closest
  }
  generateIntersections() {
    const arc = Math.atan2(this.c.y - this.closestPlaza.cy, this.c.x - this.closestPlaza.cx) + Math.PI
    const intersections = []
    for (const feature of this.context) {
      if (feature.type == 'course') {
        let intersection = intersect(
          [feature.start.x, feature.start.y],
          [feature.end.x, feature.end.y],
          [this.dest.x, this.dest.y],
          [this.end.x, this.end.y],
          0,
          false
        )
        if (intersection) {
          const dist = distance(intersection, [this.end.x, this.end.y])
          if (dist > .1) {
            intersections.push({
              feature: feature,
              point: {
                x: intersection[0],
                y: intersection[1],
              },
              dist: dist,
            })
          }
        }
      } else if (feature.type == 'boulevard') {
        let circleIntersections = svgIntersections.intersect(
          svgIntersections.shape("line", {
            x1: this.end.x,
            y1: this.end.y,
            x2: this.dest.x,
            y2: this.dest.y,
          }),
          feature.d ? svgIntersections.shape("path", {
            d: feature.d
          }) : svgIntersections.shape("circle", {
            cx: feature.c.x,
            cy: feature.c.y,
            r: feature.r,
          })
        );
        for (let intersectionPoint of circleIntersections.points) {
          intersections.push({
            feature: feature,
            point: intersectionPoint,
            dist: distance([intersectionPoint.x, intersectionPoint.y], [this.end.x, this.end.y])
          })
        }
      } else if (feature.type == 'plaza') {
        if (feature != this.closestPlaza) {
          let pointIntersections = svgIntersections.intersect(
            svgIntersections.shape("line", {
              x1: this.end.x,
              y1: this.end.y,
              x2: this.dest.x,
              y2: this.dest.y,
            }),
            svgIntersections.shape("circle", {
              cx: feature.cx,
              cy: feature.cy,
              r: .1,
            })
          )
          if (pointIntersections.points.length > 1) {
            intersections.push({
              feature: feature,
              point: { x: feature.cx, y: feature.cy },
              dist: distance([feature.cx, feature.cy], [this.end.x, this.end.y])
            })
          }
        }
      }
    }
    this.intersections = intersections.sort(this.sortByDistance)
  }
  sortByDistance(A, B) {
    return A.dist < B.dist ? -1 : 1;
  }
  background() {
    return <line
      x1={ this.start.x }
      y1={ this.start.y }
      x2={ this.end.x }
      y2={ this.end.y }
      stroke-width={ this.width }
      stroke="black"
      stroke-linecap="round"
    />
  }
  foreground(preview = false) {
    this.element = <>
      { preview && this.intersections.map( (intersection, key) => (
        <circle cx={intersection.point.x} cy={intersection.point.y} r="6" fill="skyBlue" />
      )) }
      { preview && this.segments.map( (segment, key) => (
        <line x1={segment.start.x} y1={segment.start.y} x2={segment.end.x} y2={segment.end.y} r="6" stroke="skyBlue" stroke-dasharray="4 1" />
      )) }
      <line
        x1={ this.start.x }
        y1={ this.start.y }
        x2={ this.end.x }
        y2={ this.end.y }
        stroke-linecap="round"
        stroke-width={ this.width - 2 }
        stroke={ preview ? "skyBlue" : "white" }
      />
    </>
    return this.element
  }
  preview() {
    return this.foreground(true)
  }
}

class Boulevard {
  constructor(props, context) {
    this.type = 'boulevard'

    this.width = 5

    this.target = {
      x: props.x,
      y: props.y,
    }

    this.context = context
    const closestPlazas = this.closestPlazas()
    this.c = {
      x: closestPlazas[0].feature.cx,
      y: closestPlazas[0].feature.cy
    }
    this.r = this.snapR(closestPlazas, closestPlazas[0].dist)
    this.generateIntersections()
    this.generateArcSegments()
    if (this.segments.length > 0) {
      this.arc = this.segments[0]
      this.d = this.generateD()
    }
  }
  generateD() {
    return `M ${this.segments[0].start.x},${this.segments[0].start.y} A ${this.r} ${this.r} 0 0 1 ${this.segments[0].end.x},${this.segments[0].end.y}`
  }
  generateIntersections() {
    const intersections = []
    for (const feature of this.context) {
      if (feature.type == 'course') {
        let circleIntersections = svgIntersections.intersect(
          svgIntersections.shape("line", {
            x1: feature.start.x,
            y1: feature.start.y,
            x2: feature.end.x,
            y2: feature.end.y,
          }),
          svgIntersections.shape("circle", {
            cx: this.c.x,
            cy: this.c.y,
            r: this.r,
          })
        );
        for (let intersectionPoint of circleIntersections.points) {
          intersections.push({
            feature: feature,
            point: intersectionPoint,
            dist: distance([intersectionPoint.x, intersectionPoint.y], [this.target.x, this.target.y]),
            arc: Math.atan2(intersectionPoint.y - this.c.y, intersectionPoint.x - this.c.x) + Math.PI
          })
        }
      }
    }
    this.intersections = intersections.sort(this.sortByArc)
  }
  sortByArc(A, B) {
    return A.arc < B.arc ? -1 : 1;
  }
  generateArcSegments() {
    const segments = []
    let last = null
    for (const intersection of this.intersections) {
      if (last == null) {
        last = intersection
        continue
      } else {
        segments.push({
          start: {
            arc: last.arc,
            ...last.point,
          },
          end: {
            arc: intersection.arc,
            ...intersection.point,
          }
        })
        last = intersection
      }
    }
    if (segments.length > 1) {
      segments.push({
        start: segments[segments.length - 1].end,
        end: segments[0].start,
      })
    }
    const target = Math.atan2(this.target.y - this.c.y, this.target.x - this.c.x) + Math.PI
    console.debug(target)

    this.segments = segments.sort(function(a, b){
      return Math.abs(b.start.arc - target) < Math.abs(a.start.arc - target) ? 1 : -1
    })
  }
  snapR(plazas, goal) {
    const plazaDist = distance([plazas[0].feature.cx, plazas[1].feature.cy], [plazas[1].feature.cx, plazas[0].feature.cy])
    const divisors = [4, 3]
    const radii = []
    for (let divisor of divisors) {
      for (let i = 1; i < divisor; i++) {
        radii.push(plazaDist / divisor * i)
        radii.push(plazaDist / divisor * i + goal)
      }
    }
    return radii.reduce(function(prev, curr) {
      return (Math.abs(curr - goal) < Math.abs(prev - goal) ? curr : prev)
    })
  }
  closestPlazas() {
    const featureDist = []
    for (const feature of this.context) {
      if (feature.type == 'plaza') {
        featureDist.push({
          feature: feature,
          dist: distance([this.target.x, this.target.y], [feature.cx, feature.cy])
        })
      }
    }
    const closest = featureDist.sort((A, B) => {
      return A.dist < B.dist ? -1 : 1;
    });
    return closest;
  }
  sortByDistance(A, B) {
    return A.dist < B.dist ? -1 : 1;
  }
  background() {
    return <>
      { this.segments.length > 0 && 
        <path d={`M ${this.segments[0].start.x},${this.segments[0].start.y} A ${this.r} ${this.r} 0 0 1 ${this.segments[0].end.x},${this.segments[0].end.y} `} stroke="black" fill="none" stroke-width={ this.width }  />
      }
      { this.segments.length === 0 &&
        <circle
          cx={ this.c.x }
          cy={ this.c.y }
          fill="none"
          r={ this.r }
          stroke-width={ this.width }
          stroke="black"
        />
      }
    </>
  }
  foreground(preview) {
    return <>
      { preview && this.intersections.map( (intersection, key) => (
        <circle cx={intersection.point.x} cy={intersection.point.y} r="6" fill="skyBlue" />
      )) }
      { preview && this.segments.map( (segment, key) => (
        <>
          <path d={`M ${segment.start.x},${segment.start.y} A ${this.r} ${this.r} 0 0 1 ${segment.end.x},${segment.end.y} `} stroke="skyBlue" fill="none" stroke-dasharray="4 1"  />
        </>
      )) }
      { this?.d && 
        <path d={ this.d } stroke={ preview ? "skyBlue" : "white" } fill="none" stroke-width={ this.width - 2 }  />
      }
      { this.segments.length === 0 &&
        <circle
          cx={ this.c.x }
          cy={ this.c.y }
          fill="none"
          r={ this.r }
          stroke-width={ this.width - 2 }
          stroke={ preview ? "skyBlue" : "white" }
        />
      }
    </>
  }
  preview() {
    return this.foreground(true)
  }
}


export function App() {
  const [stage, setStage] = useState(getStageMetrics())
  const [mode, setMode] = useState('plaza')
  const [features, setFeatures] = useState([])
  const updateMouse = function (e) {
    setMouse({
      x: e.clientX,
      y: e.clientY,
    })
  }
  const [mouse, setMouse] = useState({x: 0, y: 0})

  useEffect(() => {
    window.addEventListener("resize", () => {
      setStage(getStageMetrics())
    }, false)
  }, [])

  const handleClick = (e) => {
    if (mode == 'plaza') {
      setFeatures([...features, new Plaza(mouse)])
      if (features.length > 0) {
        setMode('boulevard')
      }
    }
    if (features.length > 0) {
      if (features.length % 3 == 0) {
        setMode('boulevard')
      } else {
        setMode('course')
      }
    }
    if (mode == 'course') {
      setFeatures([...features, new Course(mouse, features, true)])
    }
    if (mode == 'boulevard') {
      setFeatures([...features, new Boulevard(mouse, features, true)])
    }
  }

  return (
    <svg
      height={stage.h}
      width={stage.w}
      onMouseMove={updateMouse}
      onMouseUp={handleClick}
    >
      <g id="background">
        { features.map( (feature, key) => (
          <Fragment key={key}>
            { feature.background() }
          </Fragment>
        )) }
      </g>
      <g id="foreground">
        { features.map( (feature, key) => (
          <Fragment key={key}>
            { feature.foreground() }
          </Fragment>
        )) }
      </g>
      { mode == 'plaza' && new Plaza(mouse, features).preview() }
      { mode == 'course' && new Course(mouse, features).preview() }
      { mode == 'boulevard' && new Boulevard(mouse, features).preview() }
    </svg>
  )
}
