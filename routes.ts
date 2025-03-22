import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { insertDonationSchema } from "@shared/schema";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { storage } from "./storage";

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup authentication routes
  setupAuth(app);
  
  // School dashboard data
  app.get("/api/schools/dashboard", async (req: Request, res: Response) => {
    try {
      if (!req.isAuthenticated() || req.user.role !== 'school') {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Get school data
      const school = await storage.getSchoolByUserId(req.user.id);
      if (!school) {
        return res.status(404).json({ message: "School not found" });
      }
      
      // Get school stats
      const stats = await storage.getSchoolStats(school.id);
      
      // Get top performing students
      const topStudents = await storage.getTopPerformingStudents(school.id, 5);
      
      // Get recent donations with student info
      const schoolStudents = await storage.getStudentsBySchoolId(school.id);
      const recentDonations = [];
      
      for (const student of schoolStudents) {
        const studentDonations = await storage.getDonationsByStudentId(student.id);
        for (const donation of studentDonations) {
          recentDonations.push({
            ...donation,
            student: {
              id: student.id,
              firstName: student.firstName,
              lastName: student.lastName
            }
          });
        }
      }
      
      // Sort by creation date (most recent first) and limit to 5
      const sortedDonations = recentDonations
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 5);
      
      res.json({
        school,
        stats,
        topStudents,
        recentDonations: sortedDonations
      });
    } catch (error) {
      console.error('Error fetching school dashboard:', error);
      res.status(500).json({ message: "Failed to fetch dashboard data" });
    }
  });
  
  // Student dashboard data
  app.get("/api/students/dashboard", async (req: Request, res: Response) => {
    try {
      if (!req.isAuthenticated() || req.user.role !== 'student') {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Get student data
      const student = await storage.getStudentByUserId(req.user.id);
      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }
      
      // Get school data
      const school = await storage.getSchool(student.schoolId);
      if (!school) {
        return res.status(404).json({ message: "School not found" });
      }
      
      // Get student stats
      const stats = await storage.getStudentStats(student.id);
      
      // Get student's donations
      const donations = await storage.getDonationsByStudentId(student.id);
      
      // Calculate goal progress percentage
      const goalProgress = student.personalGoal ? 
        Math.min(100, Math.round((stats.totalRaised / parseFloat(student.personalGoal)) * 100)) : 0;
      
      // Get school stats
      const schoolStats = await storage.getSchoolStats(school.id);
      
      // Calculate school goal progress percentage
      const schoolGoalProgress = school.fundraisingGoal ? 
        Math.min(100, Math.round((schoolStats.totalRaised / school.fundraisingGoal) * 100)) : 0;
      
      // Get all students in the school
      const schoolStudents = await storage.getStudentsBySchoolId(school.id);
      
      // Generate class rankings data
      const gradeGroups: Record<string, { totalRaised: number, count: number }> = {};
      
      for (const schoolStudent of schoolStudents) {
        const grade = schoolStudent.grade;
        if (!gradeGroups[grade]) {
          gradeGroups[grade] = { totalRaised: 0, count: 0 };
        }
        
        const studentStats = await storage.getStudentStats(schoolStudent.id);
        gradeGroups[grade].totalRaised += studentStats.totalRaised;
        gradeGroups[grade].count += 1;
      }
      
      const classRankings = Object.keys(gradeGroups).map(grade => {
        return {
          grade,
          totalRaised: gradeGroups[grade].totalRaised,
          percentage: schoolStats.totalRaised > 0 ? 
            Math.round((gradeGroups[grade].totalRaised / schoolStats.totalRaised) * 100) : 0
        };
      }).sort((a, b) => b.totalRaised - a.totalRaised);
      
      // Sort donations by date (most recent first)
      const recentDonations = [...donations]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 5);
      
      // Calculate days remaining (assuming 30-day campaign that started when school was created)
      const campaignLength = 30; // days
      const today = new Date();
      const schoolCreatedDate = new Date(school.createdAt);
      const daysPassed = Math.floor((today.getTime() - schoolCreatedDate.getTime()) / (1000 * 60 * 60 * 24));
      const daysRemaining = Math.max(0, campaignLength - daysPassed);
      
      res.json({
        student,
        school,
        stats,
        goalProgress,
        schoolStats,
        schoolGoalProgress,
        classRankings,
        recentDonations,
        daysRemaining
      });
    } catch (error) {
      console.error('Error fetching student dashboard:', error);
      res.status(500).json({ message: "Failed to fetch dashboard data" });
    }
  });
  
  // Create a donation
  app.post("/api/donations", async (req: Request, res: Response) => {
    try {
      const validatedData = await insertDonationSchema.parseAsync(req.body);
      
      // Verify student exists
      const student = await storage.getStudent(validatedData.studentId);
      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }
      
      // Create donation
      const donation = await storage.createDonation(validatedData);
      
      res.status(201).json(donation);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        return res.status(400).json({ message: validationError.message });
      }
      console.error('Error creating donation:', error);
      res.status(500).json({ message: "Failed to create donation" });
    }
  });
  
  // Get donations for a student
  app.get("/api/students/:id/donations", async (req: Request, res: Response) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const studentId = parseInt(req.params.id);
      const student = await storage.getStudent(studentId);
      
      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }
      
      // Verify access permissions
      if (req.user.role === 'student') {
        // Students can only view their own donations
        const reqStudent = await storage.getStudentByUserId(req.user.id);
        if (!reqStudent || reqStudent.id !== studentId) {
          return res.status(403).json({ message: "Access denied" });
        }
      } else if (req.user.role === 'school') {
        // Schools can only view donations for their students
        const reqSchool = await storage.getSchoolByUserId(req.user.id);
        if (!reqSchool || student.schoolId !== reqSchool.id) {
          return res.status(403).json({ message: "Access denied" });
        }
      } else {
        return res.status(403).json({ message: "Access denied" });
      }
      
      // Get the donations
      const donations = await storage.getDonationsByStudentId(studentId);
      
      // Sort by creation date (most recent first)
      const sortedDonations = [...donations].sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      
      res.json(sortedDonations);
    } catch (error) {
      console.error('Error fetching donations:', error);
      res.status(500).json({ message: "Failed to fetch donations" });
    }
  });
  
  // Get all students for a school
  app.get("/api/schools/:id/students", async (req: Request, res: Response) => {
    try {
      if (!req.isAuthenticated() || req.user.role !== 'school') {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const schoolId = parseInt(req.params.id);
      
      // Get school data
      const reqSchool = await storage.getSchoolByUserId(req.user.id);
      
      // Schools can only view their own students
      if (!reqSchool || reqSchool.id !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      // Get all students for this school
      const students = await storage.getStudentsBySchoolId(schoolId);
      
      // Get stats for each student
      const studentsWithStats = await Promise.all(
        students.map(async (student) => {
          const stats = await storage.getStudentStats(student.id);
          
          // Calculate goal progress
          const goalProgress = student.personalGoal ? 
            Math.min(100, Math.round((stats.totalRaised / parseFloat(student.personalGoal)) * 100)) : 0;
          
          return {
            ...student,
            stats,
            goalProgress
          };
        })
      );
      
      // Sort by amount raised (descending)
      studentsWithStats.sort((a, b) => b.stats.totalRaised - a.stats.totalRaised);
      
      res.json(studentsWithStats);
    } catch (error) {
      console.error('Error fetching students:', error);
      res.status(500).json({ message: "Failed to fetch students" });
    }
  });
  
  // Get public school page data
  app.get("/api/schools/:id", async (req: Request, res: Response) => {
    try {
      const schoolId = parseInt(req.params.id);
      
      // Get school data
      const school = await storage.getSchool(schoolId);
      if (!school) {
        return res.status(404).json({ message: "School not found" });
      }
      
      // Get school stats
      const stats = await storage.getSchoolStats(school.id);
      
      // Get top performing students
      const topStudents = await storage.getTopPerformingStudents(school.id, 5);
      
      // Get upcoming events
      const events = await storage.getEventsBySchoolId(school.id);
      const upcomingEvents = events
        .filter(event => new Date(event.date) >= new Date())
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .slice(0, 3);
      
      // Calculate school goal progress percentage
      const goalProgress = school.fundraisingGoal ? 
        Math.min(100, Math.round((stats.totalRaised / school.fundraisingGoal) * 100)) : 0;
      
      res.json({
        school,
        stats,
        goalProgress,
        topStudents,
        upcomingEvents
      });
    } catch (error) {
      console.error('Error fetching school page:', error);
      res.status(500).json({ message: "Failed to fetch school page data" });
    }
  });
  
  // Get school events
  app.get("/api/schools/:id/events", async (req: Request, res: Response) => {
    try {
      const schoolId = parseInt(req.params.id);
      
      // Verify school exists
      const school = await storage.getSchool(schoolId);
      if (!school) {
        return res.status(404).json({ message: "School not found" });
      }
      
      // Get all events for this school
      const events = await storage.getEventsBySchoolId(schoolId);
      
      // Sort by date (soonest first)
      const sortedEvents = [...events].sort((a, b) => 
        new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      
      res.json(sortedEvents);
    } catch (error) {
      console.error('Error fetching events:', error);
      res.status(500).json({ message: "Failed to fetch events" });
    }
  });
  
  // Create school event (school admin only)
  app.post("/api/schools/:id/events", async (req: Request, res: Response) => {
    try {
      if (!req.isAuthenticated() || req.user.role !== 'school') {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const schoolId = parseInt(req.params.id);
      
      // Verify the user is admin of this school
      const reqSchool = await storage.getSchoolByUserId(req.user.id);
      if (!reqSchool || reqSchool.id !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      // Validate and create event
      const eventData = {
        ...req.body,
        schoolId
      };
      
      const event = await storage.createEvent(eventData);
      
      res.status(201).json(event);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        return res.status(400).json({ message: validationError.message });
      }
      console.error('Error creating event:', error);
      res.status(500).json({ message: "Failed to create event" });
    }
  });
  
  // Update school event (school admin only)
  app.put("/api/events/:id", async (req: Request, res: Response) => {
    try {
      if (!req.isAuthenticated() || req.user.role !== 'school') {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const eventId = parseInt(req.params.id);
      
      // Get the event
      const event = await storage.getEvent(eventId);
      if (!event) {
        return res.status(404).json({ message: "Event not found" });
      }
      
      // Verify the user is admin of this school
      const reqSchool = await storage.getSchoolByUserId(req.user.id);
      if (!reqSchool || reqSchool.id !== event.schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      // Update the event
      const updatedEvent = await storage.updateEvent(eventId, req.body);
      
      res.json(updatedEvent);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        return res.status(400).json({ message: validationError.message });
      }
      console.error('Error updating event:', error);
      res.status(500).json({ message: "Failed to update event" });
    }
  });
  
  // Delete school event (school admin only)
  app.delete("/api/events/:id", async (req: Request, res: Response) => {
    try {
      if (!req.isAuthenticated() || req.user.role !== 'school') {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const eventId = parseInt(req.params.id);
      
      // Get the event
      const event = await storage.getEvent(eventId);
      if (!event) {
        return res.status(404).json({ message: "Event not found" });
      }
      
      // Verify the user is admin of this school
      const reqSchool = await storage.getSchoolByUserId(req.user.id);
      if (!reqSchool || reqSchool.id !== event.schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      // Delete the event
      await storage.deleteEvent(eventId);
      
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting event:', error);
      res.status(500).json({ message: "Failed to delete event" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}