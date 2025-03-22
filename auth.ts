import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User as SelectUser } from "@shared/schema";

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function comparePasswords(supplied: string, stored: string) {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

export function setupAuth(app: Express) {
  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || "fundraiser_secret_key",
    resave: false,
    saveUninitialized: false,
    store: storage.sessionStore,
    cookie: { 
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 1 week
      httpOnly: true,
    }
  };

  app.set("trust proxy", 1);
  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      const user = await storage.getUserByUsername(username);
      if (!user || !(await comparePasswords(password, user.password))) {
        return done(null, false);
      } else {
        return done(null, user);
      }
    }),
  );

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id: number, done) => {
    const user = await storage.getUser(id);
    done(null, user);
  });

  // Get list of all schools (for student registration dropdown) - public endpoint
  app.get("/api/schools", async (req, res) => {
    try {
      const schools = await storage.getAllSchools();
      res.status(200).json(schools);
    } catch (error) {
      console.error('Error getting schools:', error);
      res.status(500).json({ message: 'Failed to get schools' });
    }
  });

  app.post("/api/register", async (req, res, next) => {
    const existingUser = await storage.getUserByUsername(req.body.username);
    if (existingUser) {
      return res.status(400).send("Username already exists");
    }

    const user = await storage.createUser({
      ...req.body,
      password: await hashPassword(req.body.password),
    });

    req.login(user, (err) => {
      if (err) return next(err);
      res.status(201).json(user);
    });
  });

  // Register a school
  app.post("/api/register/school", async (req, res) => {
    try {
      const { username, email, password, confirmPassword, schoolName, adminName, address, phone, fundraisingGoal } = req.body;
      
      // Check if username or email already exists
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }
      
      const existingEmail = await storage.getUserByEmail(email);
      if (existingEmail) {
        return res.status(400).json({ message: "Email already exists" });
      }
      
      // Create user
      const user = await storage.createUser({
        username,
        email,
        password: await hashPassword(password),
        role: 'school',
      });
      
      // Create school
      const school = await storage.createSchool({
        userId: user.id,
        name: schoolName,
        adminName,
        address,
        phone,
        fundraisingGoal: fundraisingGoal ? Number(fundraisingGoal) : 0,
      });
      
      // Login the user
      req.login(user, (err) => {
        if (err) {
          console.error('Login error after registration:', err);
          return res.status(500).json({ message: "Registration successful but failed to login" });
        }
        res.status(201).json({ user, school });
      });
    } catch (error) {
      console.error('Error registering school:', error);
      res.status(500).json({ message: "Failed to register user" });
    }
  });
  
  // Register a student
  app.post("/api/register/student", async (req, res) => {
    try {
      const { username, email, password, firstName, lastName, grade, schoolId, personalGoal, parentConsent } = req.body;
      
      // Check if school exists
      const school = await storage.getSchool(schoolId);
      if (!school) {
        return res.status(400).json({ message: "Selected school does not exist" });
      }
      
      // Check if username or email already exists
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }
      
      const existingEmail = await storage.getUserByEmail(email);
      if (existingEmail) {
        return res.status(400).json({ message: "Email already exists" });
      }
      
      // Create user
      const user = await storage.createUser({
        username,
        email,
        password: await hashPassword(password),
        role: 'student',
      });
      
      // Create student
      const student = await storage.createStudent({
        userId: user.id,
        schoolId,
        firstName,
        lastName,
        grade,
        personalGoal: personalGoal ? Number(personalGoal) : null,
      });
      
      // Login the user
      req.login(user, (err) => {
        if (err) {
          console.error('Login error after registration:', err);
          return res.status(500).json({ message: "Registration successful but failed to login" });
        }
        res.status(201).json({ user, student });
      });
    } catch (error) {
      console.error('Error registering student:', error);
      res.status(500).json({ message: "Failed to register user" });
    }
  });

  app.post("/api/login", passport.authenticate("local"), (req, res) => {
    res.status(200).json(req.user);
  });

  app.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.sendStatus(200);
    });
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    res.json(req.user);
  });
  
  // Get the full profile based on user role
  app.get("/api/profile", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    
    try {
      const userId = req.user.id;
      const user = req.user;
      
      if (user.role === 'school') {
        const school = await storage.getSchoolByUserId(userId);
        if (!school) {
          return res.status(404).json({ message: 'School profile not found' });
        }
        
        // Get school stats
        const stats = await storage.getSchoolStats(school.id);
        
        return res.json({ 
          user, 
          school, 
          stats 
        });
      } else if (user.role === 'student') {
        const student = await storage.getStudentByUserId(userId);
        if (!student) {
          return res.status(404).json({ message: 'Student profile not found' });
        }
        
        // Get student's school
        const school = await storage.getSchool(student.schoolId);
        
        // Get student stats
        const stats = await storage.getStudentStats(student.id);
        
        return res.json({ 
          user, 
          student, 
          school,
          stats 
        });
      } else {
        return res.status(400).json({ message: 'Unknown user role' });
      }
    } catch (error) {
      console.error('Error getting profile:', error);
      res.status(500).json({ message: 'Failed to fetch profile' });
    }
  });
}